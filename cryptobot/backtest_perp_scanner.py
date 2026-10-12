#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Binance USDT-M Perpetual Sinyal Tarayici + Funding Harvest Dashboard
=====================================================================

KARAR DESTEK ARACIDIR -- TRADE BOTU DEGILDIR. Hicbir emir gondermez,
API key kullanmaz; yalnizca Binance public endpoint'lerinden veri okur.

Modlar:
    --mode backtest   : Gecmis veride sinyal motorunu test eder (--engine v1/v2)
    --mode scan       : Top N perpetual'i tarar, sonuclari konsola yazar
    --mode dashboard  : Tarama + harvest + dashboard.html + ozet + bildirim
    --mode serve      : localhost:8765 HTTP server (/, /api/scan, /api/status)

Sinyal motoru v2 (6 bagimsiz kategori, her biri -1/0/+1, net skor +-6):
    1. Trend          : SuperTrend(ATR10, mult 3)
    2. Momentum       : RSI(14) esik (<30 / >70) + 14-bar RSI divergence
    3. Money flow     : CVD divergence (taker buy volume kumulatif delta)
    4. Positioning-F  : Yilliklastirilmis funding (<-10% long, >+50% short)
    5. Positioning-OI : 24s OI delta + fiyat iliskisi (buildup tespiti)
    6. Mean reversion : Bollinger(20,2) band asimi

Rejim filtresi: BTC gunluk kapanis EMA200 altindaysa long skorlar %50 sonumlenir.
raw_net (filtresiz) ve net (filtreli) ayri saklanir.
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import html
import json
import logging
import math
import os
import subprocess
import sys
import threading
import time
import traceback
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import numpy as np
import pandas as pd
import requests

try:
    import ccxt  # type: ignore
except ImportError:  # pragma: no cover - kurulum hatasi
    ccxt = None

# ---------------------------------------------------------------------------
# Sabitler / yollar
# ---------------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
DASHBOARD_HTML = BASE_DIR / "dashboard.html"
SUMMARY_MD = BASE_DIR / "dashboard_summary.md"
SCAN_JSON = BASE_DIR / "scan_results.json"
BACKTEST_DIR = BASE_DIR / "backtest_results"

FAPI = "https://fapi.binance.com"
SPOT_API = "https://api.binance.com"

DEFAULT_PORT = 8765
DEFAULT_TIMEFRAME = "4h"
TF_HOURS = {"15m": 0.25, "30m": 0.5, "1h": 1, "2h": 2, "4h": 4, "6h": 6, "8h": 8, "12h": 12, "1d": 24}

# Indikator parametreleri
ST_PERIOD = 10
ST_MULT = 3.0
RSI_PERIOD = 14
RSI_LOW = 30.0
RSI_HIGH = 70.0
DIV_LOOKBACK = 14
DIV_RECENT = 3
BB_PERIOD = 20
BB_STD = 2.0
FUNDING_LONG_TH = -10.0   # yillik % altinda -> long (kalabalik short)
FUNDING_SHORT_TH = 50.0   # yillik % ustunde -> short (kalabalik long)
OI_DELTA_TH = 5.0         # 24s OI degisimi % esigi
PRICE_DELTA_TH = 1.0      # 24s fiyat degisimi % esigi
BEAR_LONG_DAMPING = 0.5
STRONG_TH = 3.0           # |net| >= 3 -> guclu sinyal

# Funding harvest parametreleri
HARVEST_MIN_QUOTE_VOL = 20_000_000.0   # perp 24s USDT hacim
HARVEST_MIN_SPOT_VOL = 5_000_000.0     # spot 24s USDT hacim
HARVEST_CANDIDATES = 40                # volatilite analizine giren aday sayisi
HARVEST_TOP = 15
HARVEST_DAYS = 30

STABLE_BASES = {"USDC", "BUSD", "TUSD", "FDUSD", "USDP", "DAI", "USDE", "EUR", "UST", "USD1", "PYUSD"}

AUTO_REFRESH_MIN = 10
AUTO_SCAN_STALE_MIN = 60

HTTP_TIMEOUT = 15
USER_AGENT = "CryptoBot-Scanner/2.0 (decision-support; no-trading)"

log = logging.getLogger("cryptobot")


def setup_logging(verbose: bool = False, log_file: Optional[str] = None) -> None:
    """
    Konsol + opsiyonel dosya loglama. Windows arka plan gorevinde (pythonw/gizli
    pencere) stdout olmayabilir; bu durumda yalnizca dosyaya yazilir.
    Hatalar (WARNING+) ayrica server.err'e gider.
    """
    level = logging.DEBUG if verbose else logging.INFO
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", "%Y-%m-%d %H:%M:%S")
    root = logging.getLogger()
    root.setLevel(level)
    for h in list(root.handlers):
        root.removeHandler(h)
    if sys.stdout is not None:
        sh = logging.StreamHandler(sys.stdout)
        sh.setFormatter(fmt)
        root.addHandler(sh)
    if log_file:
        lf = Path(log_file)
        if not lf.is_absolute():
            lf = BASE_DIR / lf
        fh = logging.FileHandler(lf, encoding="utf-8")
        fh.setFormatter(fmt)
        root.addHandler(fh)
        eh = logging.FileHandler(lf.with_suffix(".err"), encoding="utf-8")
        eh.setLevel(logging.WARNING)
        eh.setFormatter(fmt)
        root.addHandler(eh)

        def _excepthook(tp, val, tb):  # yakalanmamis hatalar da log'a
            logging.getLogger("cryptobot").critical("Yakalanmamis hata", exc_info=(tp, val, tb))
        sys.excepthook = _excepthook
    logging.getLogger("urllib3").setLevel(logging.WARNING)


# ---------------------------------------------------------------------------
# HTTP yardimcilari
# ---------------------------------------------------------------------------

_session_local = threading.local()


def http_session() -> requests.Session:
    s = getattr(_session_local, "s", None)
    if s is None:
        s = requests.Session()
        s.headers.update({"User-Agent": USER_AGENT})
        _session_local.s = s
    return s


def http_get(url: str, params: Optional[dict] = None, retries: int = 4) -> Any:
    """Basit retry/backoff'lu GET. 418/429'da bekler."""
    delay = 1.0
    last_exc: Optional[Exception] = None
    for attempt in range(retries):
        try:
            r = http_session().get(url, params=params, timeout=HTTP_TIMEOUT)
            if r.status_code in (418, 429):
                wait = float(r.headers.get("Retry-After", delay * 4))
                log.warning("Rate limit (%s) %s -> %.0fs bekleniyor", r.status_code, url, wait)
                time.sleep(min(wait, 120))
                delay *= 2
                continue
            if r.status_code == 451:
                raise RuntimeError(
                    "Binance bu bolgeden erisimi engelliyor (HTTP 451). VPN/farkli bolge gerekebilir."
                )
            r.raise_for_status()
            return r.json()
        except RuntimeError:
            raise
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            log.debug("GET hata (%d/%d) %s: %s", attempt + 1, retries, url, exc)
            time.sleep(delay)
            delay *= 2
    raise RuntimeError(f"GET basarisiz: {url} params={params}: {last_exc}")


def make_exchange() -> Any:
    if ccxt is None:
        raise RuntimeError("ccxt kurulu degil: pip install ccxt")
    ex = ccxt.binanceusdm({"enableRateLimit": True, "timeout": HTTP_TIMEOUT * 1000})
    return ex


def make_spot_exchange() -> Any:
    if ccxt is None:
        raise RuntimeError("ccxt kurulu degil: pip install ccxt")
    return ccxt.binance({"enableRateLimit": True, "timeout": HTTP_TIMEOUT * 1000})


def market_id(symbol: str) -> str:
    """'BTC/USDT:USDT' -> 'BTCUSDT'"""
    base_quote = symbol.split(":")[0]
    return base_quote.replace("/", "")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def fmt_ts(ts: float) -> str:
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M")


# ---------------------------------------------------------------------------
# Indikatorler (vektorize)
# ---------------------------------------------------------------------------

def ema_series(s: pd.Series, n: int) -> pd.Series:
    """Klasik EMA (span=n, adjust=False)."""
    return s.ewm(span=n, adjust=False, min_periods=n).mean()


def ema(s: pd.Series, n: int) -> pd.Series:
    return ema_series(s, n)


def wilder(s: pd.Series, n: int) -> pd.Series:
    """Wilder smoothing = EMA(alpha=1/n)."""
    return s.ewm(alpha=1.0 / n, adjust=False, min_periods=n).mean()


def true_range(df: pd.DataFrame) -> pd.Series:
    prev_close = df["close"].shift(1)
    tr = pd.concat(
        [
            df["high"] - df["low"],
            (df["high"] - prev_close).abs(),
            (df["low"] - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return tr


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    return wilder(true_range(df), n)


def rsi(close: pd.Series, n: int = RSI_PERIOD) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = (-delta).clip(lower=0.0)
    avg_gain = wilder(gain, n)
    avg_loss = wilder(loss, n)
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    out = 100.0 - 100.0 / (1.0 + rs)
    # Hic kayip yoksa RSI=100
    out = out.where(~((avg_loss == 0) & avg_gain.notna()), 100.0)
    return out


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    m = ema_series(close, fast) - ema_series(close, slow)
    sig = ema_series(m, signal)
    return pd.DataFrame({"macd": m, "signal": sig, "hist": m - sig})


def bollinger(close: pd.Series, n: int = BB_PERIOD, k: float = BB_STD) -> pd.DataFrame:
    mid = close.rolling(n, min_periods=n).mean()
    sd = close.rolling(n, min_periods=n).std(ddof=0)
    upper = mid + k * sd
    lower = mid - k * sd
    width = (upper - lower) / mid
    pct_b = (close - lower) / (upper - lower)
    return pd.DataFrame({"mid": mid, "upper": upper, "lower": lower, "width": width, "pct_b": pct_b})


def adx(df: pd.DataFrame, n: int = 14) -> pd.DataFrame:
    up = df["high"].diff()
    down = -df["low"].diff()
    plus_dm = np.where((up > down) & (up > 0), up, 0.0)
    minus_dm = np.where((down > up) & (down > 0), down, 0.0)
    tr_s = wilder(true_range(df), n)
    plus_di = 100.0 * wilder(pd.Series(plus_dm, index=df.index), n) / tr_s
    minus_di = 100.0 * wilder(pd.Series(minus_dm, index=df.index), n) / tr_s
    dx = 100.0 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0.0, np.nan)
    adx_ = wilder(dx, n)
    return pd.DataFrame({"adx": adx_, "plus_di": plus_di, "minus_di": minus_di})


def supertrend(df: pd.DataFrame, period: int = ST_PERIOD, mult: float = ST_MULT) -> pd.DataFrame:
    """
    SuperTrend. Bant hesaplari vektorize; band tasima (carry) ve yon degisimi
    dogasi geregi yola bagimli oldugundan numpy dizileri uzerinde tek gecislik dongu.
    Donus: st (cizgi), dir (+1 yukari trend, -1 asagi trend)
    """
    a = atr(df, period).to_numpy()
    hl2 = ((df["high"] + df["low"]) / 2.0).to_numpy()
    close = df["close"].to_numpy()
    basic_ub = hl2 + mult * a
    basic_lb = hl2 - mult * a
    n = len(df)
    final_ub = np.full(n, np.nan)
    final_lb = np.full(n, np.nan)
    direction = np.zeros(n, dtype=np.int8)
    st = np.full(n, np.nan)

    start = int(np.argmax(~np.isnan(a))) if np.any(~np.isnan(a)) else n
    for i in range(start, n):
        if i == start:
            final_ub[i] = basic_ub[i]
            final_lb[i] = basic_lb[i]
            direction[i] = 1 if close[i] >= hl2[i] else -1
        else:
            final_ub[i] = (
                basic_ub[i]
                if (basic_ub[i] < final_ub[i - 1] or close[i - 1] > final_ub[i - 1])
                else final_ub[i - 1]
            )
            final_lb[i] = (
                basic_lb[i]
                if (basic_lb[i] > final_lb[i - 1] or close[i - 1] < final_lb[i - 1])
                else final_lb[i - 1]
            )
            prev = direction[i - 1]
            if prev == -1 and close[i] > final_ub[i - 1]:
                direction[i] = 1
            elif prev == 1 and close[i] < final_lb[i - 1]:
                direction[i] = -1
            else:
                direction[i] = prev
        st[i] = final_lb[i] if direction[i] == 1 else final_ub[i]

    return pd.DataFrame({"st": st, "dir": direction.astype(int)}, index=df.index)


# ---------------------------------------------------------------------------
# Divergence
# ---------------------------------------------------------------------------

def detect_divergence(
    low: np.ndarray,
    high: np.ndarray,
    osc: np.ndarray,
    lookback: int = DIV_LOOKBACK,
    recent: int = DIV_RECENT,
) -> int:
    """
    Son `lookback` bar penceresinde son `recent` bar (guncel pivot bolgesi) ile
    onceki bolumun ekstremumlarini karsilastirir.
      +1 bullish: fiyat daha dusuk dip, osilator daha yuksek dip
      -1 bearish: fiyat daha yuksek tepe, osilator daha dusuk tepe
       0 yok (ya da ikisi birden -> belirsiz)
    """
    low = np.asarray(low, dtype=float)
    high = np.asarray(high, dtype=float)
    osc = np.asarray(osc, dtype=float)
    if len(low) < lookback or len(osc) < lookback:
        return 0
    lw, hw, ow = low[-lookback:], high[-lookback:], osc[-lookback:]
    if np.isnan(ow).any() or np.isnan(lw).any() or np.isnan(hw).any():
        return 0
    split = lookback - recent
    pl, rl = lw[:split], lw[split:]
    ph, rh = hw[:split], hw[split:]
    po, ro = ow[:split], ow[split:]

    i_pl, i_rl = int(np.argmin(pl)), int(np.argmin(rl))
    i_ph, i_rh = int(np.argmax(ph)), int(np.argmax(rh))

    bull = rl[i_rl] < pl[i_pl] and ro[i_rl] > po[i_pl]
    bear = rh[i_rh] > ph[i_ph] and ro[i_rh] < po[i_ph]
    if bull and not bear:
        return 1
    if bear and not bull:
        return -1
    return 0


def rolling_divergence(
    low: pd.Series,
    high: pd.Series,
    osc: pd.Series,
    lookback: int = DIV_LOOKBACK,
    recent: int = DIV_RECENT,
) -> pd.Series:
    """detect_divergence'in tum seri icin vektorize hali (sliding_window_view)."""
    n = len(low)
    out = np.zeros(n, dtype=int)
    if n < lookback:
        return pd.Series(out, index=low.index)
    from numpy.lib.stride_tricks import sliding_window_view as swv

    lw = swv(low.to_numpy(dtype=float), lookback)
    hw = swv(high.to_numpy(dtype=float), lookback)
    ow = swv(osc.to_numpy(dtype=float), lookback)
    split = lookback - recent

    pl, rl = lw[:, :split], lw[:, split:]
    ph, rh = hw[:, :split], hw[:, split:]
    po, ro = ow[:, :split], ow[:, split:]

    rows = np.arange(lw.shape[0])
    i_pl = np.argmin(pl, axis=1)
    i_rl = np.argmin(rl, axis=1)
    i_ph = np.argmax(ph, axis=1)
    i_rh = np.argmax(rh, axis=1)

    bull = (rl[rows, i_rl] < pl[rows, i_pl]) & (ro[rows, i_rl] > po[rows, i_pl])
    bear = (rh[rows, i_rh] > ph[rows, i_ph]) & (ro[rows, i_rh] < po[rows, i_ph])
    valid = ~(np.isnan(ow).any(axis=1) | np.isnan(lw).any(axis=1) | np.isnan(hw).any(axis=1))

    sig = np.where(bull & ~bear, 1, np.where(bear & ~bull, -1, 0))
    sig = np.where(valid, sig, 0)
    out[lookback - 1:] = sig
    return pd.Series(out, index=low.index)


# ---------------------------------------------------------------------------
# Veri cekme
# ---------------------------------------------------------------------------

def _tf_ms(timeframe: str) -> int:
    return int(TF_HOURS[timeframe] * 3600 * 1000)


def fetch_ohlcv_paged(ex: Any, symbol: str, timeframe: str, since_ms: int, limit: int = 1500) -> pd.DataFrame:
    rows: List[list] = []
    cursor = since_ms
    step = _tf_ms(timeframe)
    end_ms = ex.milliseconds()
    while cursor < end_ms:
        batch = ex.fetch_ohlcv(symbol, timeframe=timeframe, since=cursor, limit=limit)
        if not batch:
            break
        rows.extend(batch)
        last = batch[-1][0]
        if last <= cursor:
            break
        cursor = last + step
        if len(batch) < limit:
            break
    if not rows:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
    df = pd.DataFrame(rows, columns=["ts", "open", "high", "low", "close", "volume"])
    df = df.drop_duplicates("ts").sort_values("ts")
    df.index = pd.to_datetime(df["ts"], unit="ms", utc=True)
    return df[["open", "high", "low", "close", "volume"]].astype(float)


def fetch_funding_history(ex: Any, symbol: str, since_ms: int) -> pd.Series:
    rows: List[dict] = []
    cursor = since_ms
    end_ms = ex.milliseconds()
    while cursor < end_ms:
        batch = ex.fetch_funding_rate_history(symbol, since=cursor, limit=1000)
        if not batch:
            break
        rows.extend(batch)
        last = batch[-1]["timestamp"]
        if last <= cursor:
            break
        cursor = last + 1
        if len(batch) < 1000:
            break
    if not rows:
        return pd.Series(dtype=float, name="funding")
    s = pd.Series(
        [float(r["fundingRate"]) for r in rows],
        index=pd.to_datetime([r["timestamp"] for r in rows], unit="ms", utc=True),
        name="funding",
    )
    return s[~s.index.duplicated()].sort_index()


def fetch_oi_history(ex: Any, symbol: str, period: str = "1h", limit: int = 500) -> pd.Series:
    """
    OI gecmisi. Binance /futures/data/openInterestHist yalnizca son ~30 gunu verir.
    Once ccxt, olmazsa dogrudan REST.
    """
    try:
        data = ex.fetch_open_interest_history(symbol, period, limit=min(limit, 500))
        if data:
            vals = []
            for d in data:
                v = d.get("openInterestAmount")
                if v is None:
                    v = (d.get("info") or {}).get("sumOpenInterest")
                vals.append(float(v) if v is not None else np.nan)
            s = pd.Series(
                vals,
                index=pd.to_datetime([d["timestamp"] for d in data], unit="ms", utc=True),
                name="oi",
            )
            return s[~s.index.duplicated()].sort_index()
    except Exception as exc:  # noqa: BLE001
        log.debug("ccxt OI hist hata %s: %s -> REST", symbol, exc)
    return fetch_oi_history_rest(market_id(symbol), period, limit)


def fetch_oi_history_rest(sym_id: str, period: str = "1h", limit: int = 30) -> pd.Series:
    data = http_get(
        f"{FAPI}/futures/data/openInterestHist",
        {"symbol": sym_id, "period": period, "limit": min(limit, 500)},
    )
    if not data:
        return pd.Series(dtype=float, name="oi")
    s = pd.Series(
        [float(d["sumOpenInterest"]) for d in data],
        index=pd.to_datetime([int(d["timestamp"]) for d in data], unit="ms", utc=True),
        name="oi",
    )
    return s.sort_index()


def fetch_cvd_binance(sym_id: str, interval: str = DEFAULT_TIMEFRAME, limit: int = 500,
                      start_ms: Optional[int] = None) -> pd.DataFrame:
    """
    Ham Binance klines -> OHLCV + taker buy volume + CVD.
    delta = taker_buy - taker_sell = 2*taker_buy - volume ; cvd = cumsum(delta)
    start_ms verilirse sayfalayarak bugune kadar ceker.
    """
    rows: List[list] = []
    if start_ms is None:
        rows = http_get(f"{FAPI}/fapi/v1/klines", {"symbol": sym_id, "interval": interval, "limit": min(limit, 1500)})
    else:
        cursor = start_ms
        step = _tf_ms(interval)
        end_ms = int(time.time() * 1000)
        while cursor < end_ms:
            batch = http_get(
                f"{FAPI}/fapi/v1/klines",
                {"symbol": sym_id, "interval": interval, "startTime": cursor, "limit": 1500},
            )
            if not batch:
                break
            rows.extend(batch)
            last = int(batch[-1][0])
            if last <= cursor or len(batch) < 1500:
                break
            cursor = last + step
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(
        rows,
        columns=[
            "ts", "open", "high", "low", "close", "volume", "close_time", "quote_volume",
            "trades", "taker_buy", "taker_buy_quote", "ignore",
        ],
    )
    df = df.drop_duplicates("ts").sort_values("ts")
    df.index = pd.to_datetime(df["ts"].astype("int64"), unit="ms", utc=True)
    for c in ["open", "high", "low", "close", "volume", "quote_volume", "taker_buy", "taker_buy_quote"]:
        df[c] = df[c].astype(float)
    df["delta"] = 2.0 * df["taker_buy"] - df["volume"]
    df["cvd"] = df["delta"].cumsum()
    # Son bar henuz kapanmadiysa at (yarim bar sinyal kirletir)
    if len(df) and int(df["close_time"].iloc[-1]) > int(time.time() * 1000):
        df = df.iloc[:-1]
    return df[["open", "high", "low", "close", "volume", "quote_volume", "taker_buy", "delta", "cvd"]]


def fetch_data(ex: Any, symbol: str, timeframe: str = DEFAULT_TIMEFRAME, days: int = 365) -> pd.DataFrame:
    """
    Backtest verisi: OHLCV (ccxt) + funding history (ccxt, bara ffill) +
    OI history (son 30g, bara ffill) + taker buy / CVD (ham klines).
    """
    since = ex.milliseconds() - days * 86_400_000
    df = fetch_ohlcv_paged(ex, symbol, timeframe, since)
    if df.empty:
        return df

    try:
        kl = fetch_cvd_binance(market_id(symbol), timeframe, start_ms=since)
        df = df.join(kl[["taker_buy", "delta", "cvd"]], how="left")
    except Exception as exc:  # noqa: BLE001
        log.warning("%s CVD alinamadi: %s", symbol, exc)
        df["taker_buy"] = np.nan
        df["delta"] = np.nan
        df["cvd"] = np.nan

    try:
        fund = fetch_funding_history(ex, symbol, since - 86_400_000)
        df["funding"] = fund.reindex(df.index.union(fund.index)).ffill().reindex(df.index)
    except Exception as exc:  # noqa: BLE001
        log.warning("%s funding history alinamadi: %s", symbol, exc)
        df["funding"] = np.nan

    try:
        oi = fetch_oi_history(ex, symbol, "1h", 500)
        df["oi"] = oi.reindex(df.index.union(oi.index)).ffill().reindex(df.index)
    except Exception as exc:  # noqa: BLE001
        log.debug("%s OI history alinamadi: %s", symbol, exc)
        df["oi"] = np.nan

    return df


def fetch_btc_regime(timeframe_days: int = 400) -> Dict[str, Any]:
    """BTC gunluk kapanis vs EMA200 -> bull/bear."""
    rows = http_get(f"{FAPI}/fapi/v1/klines", {"symbol": "BTCUSDT", "interval": "1d", "limit": timeframe_days})
    close = pd.Series([float(r[4]) for r in rows],
                      index=pd.to_datetime([int(r[0]) for r in rows], unit="ms", utc=True))
    e200 = ema_series(close, 200)
    # Kapanmis son gunluk bar
    closed = close.iloc[:-1] if len(close) > 1 else close
    last_close = float(closed.iloc[-1])
    last_ema = float(e200.iloc[len(closed) - 1])
    live_price = float(close.iloc[-1])
    chg_24h = (live_price / last_close - 1.0) * 100.0 if last_close else 0.0
    bull = bool(last_close >= last_ema) if not math.isnan(last_ema) else True
    return {
        "price": live_price,
        "daily_close": last_close,
        "ema200": last_ema,
        "dist_pct": (last_close / last_ema - 1.0) * 100.0 if last_ema else 0.0,
        "bull": bull,
        "regime": "BOGA (EMA200 ustu)" if bull else "AYI (EMA200 alti)",
        "chg_24h": chg_24h,
    }


def fetch_btc_regime_mask(ex: Any, index: pd.DatetimeIndex, days: int = 365) -> pd.Series:
    """
    Backtest icin: her bar zamaninda BTC rejimi bull mu? (True/False)
    Look-ahead olmasin diye gunluk sinyal bir gun kaydirilir (kapanmis gunu kullanir).
    """
    since = ex.milliseconds() - (days + 260) * 86_400_000
    d = fetch_ohlcv_paged(ex, "BTC/USDT:USDT", "1d", since)
    if d.empty:
        return pd.Series(True, index=index)
    e200 = ema_series(d["close"], 200)
    bull = (d["close"] >= e200) | e200.isna()
    bull.index = bull.index + pd.Timedelta(days=1)  # gun kapandiktan sonra gecerli
    mask = bull.reindex(bull.index.union(index)).ffill().reindex(index)
    return mask.fillna(True).astype(bool)


# ---------------------------------------------------------------------------
# Sinyal motoru v2
# ---------------------------------------------------------------------------

CATEGORY_KEYS = ["trend", "momentum", "cvd", "funding", "oi", "meanrev"]
CATEGORY_LABELS = {
    "trend": "Trend (SuperTrend)",
    "momentum": "Momentum (RSI esik+div)",
    "cvd": "Money flow (CVD div)",
    "funding": "Funding (yillik)",
    "oi": "OI buildup",
    "meanrev": "Mean rev (Bollinger)",
}


def funding_annualized(rate: float, interval_hours: float = 8.0) -> float:
    """Funding orani -> yillik %."""
    if rate is None or (isinstance(rate, float) and math.isnan(rate)):
        return float("nan")
    return float(rate) * (24.0 / interval_hours) * 365.0 * 100.0


def score_funding(ann_pct: float) -> int:
    if ann_pct is None or math.isnan(ann_pct):
        return 0
    if ann_pct < FUNDING_LONG_TH:
        return 1
    if ann_pct > FUNDING_SHORT_TH:
        return -1
    return 0


def score_oi(oi_delta_pct: float, price_delta_pct: float) -> int:
    """
    OI artiyor + fiyat artiyor -> yeni long girisi (trend teyidi) +1
    OI artiyor + fiyat dusuyor -> yeni short girisi (short buildup) -1
    OI dusuyor -> pozisyon kapanisi (short squeeze / long liquidation), notr 0
    """
    if any(x is None or math.isnan(x) for x in (oi_delta_pct, price_delta_pct)):
        return 0
    if oi_delta_pct >= OI_DELTA_TH and price_delta_pct >= PRICE_DELTA_TH:
        return 1
    if oi_delta_pct >= OI_DELTA_TH and price_delta_pct <= -PRICE_DELTA_TH:
        return -1
    return 0


def apply_regime(raw_net: float, bull: bool) -> float:
    if not bull and raw_net > 0:
        return raw_net * BEAR_LONG_DAMPING
    return float(raw_net)


def scan_last_bar_v2(
    df: pd.DataFrame,
    funding_rate: Optional[float],
    oi_series: Optional[pd.Series],
    regime_bull: bool,
    funding_interval_h: float = 8.0,
) -> Dict[str, Any]:
    """
    Son kapanmis bar icin ayrintili sinyal sozlugu.
    df: open/high/low/close/volume (+ opsiyonel cvd) kolonlari, kapanmis barlar.
    """
    if len(df) < max(BB_PERIOD, DIV_LOOKBACK, ST_PERIOD, RSI_PERIOD) + 10:
        raise ValueError("yetersiz bar")

    close = df["close"]
    st = supertrend(df)
    r = rsi(close)
    bb = bollinger(close)

    last_close = float(close.iloc[-1])
    st_dir = int(st["dir"].iloc[-1])
    r_last = float(r.iloc[-1])

    # 1. Trend
    s_trend = 1 if st_dir == 1 else -1

    # 2. Momentum: esik + divergence -> tek kategori, [-1,1]'e kirpilir
    s_rsi_th = 1 if r_last < RSI_LOW else (-1 if r_last > RSI_HIGH else 0)
    s_rsi_div = detect_divergence(df["low"].to_numpy(), df["high"].to_numpy(), r.to_numpy())
    s_momentum = int(np.clip(s_rsi_th + s_rsi_div, -1, 1))

    # 3. CVD divergence
    s_cvd = 0
    if "cvd" in df.columns and df["cvd"].notna().sum() >= DIV_LOOKBACK:
        s_cvd = detect_divergence(df["low"].to_numpy(), df["high"].to_numpy(), df["cvd"].to_numpy())

    # 4. Funding
    f_ann = funding_annualized(funding_rate, funding_interval_h) if funding_rate is not None else float("nan")
    s_funding = score_funding(f_ann)

    # 5. OI 24s delta
    oi_delta = float("nan")
    price_delta = float("nan")
    if oi_series is not None and len(oi_series) >= 2:
        oi_s = oi_series.dropna()
        if len(oi_s) >= 2:
            t_end = oi_s.index[-1]
            past = oi_s[oi_s.index <= t_end - pd.Timedelta(hours=24)]
            ref = float(past.iloc[-1]) if len(past) else float(oi_s.iloc[0])
            if ref > 0:
                oi_delta = (float(oi_s.iloc[-1]) / ref - 1.0) * 100.0
    bars_24h = max(1, int(round(24 / max(_infer_tf_hours(df), 1e-9))))
    if len(close) > bars_24h:
        price_delta = (last_close / float(close.iloc[-1 - bars_24h]) - 1.0) * 100.0
    s_oi = score_oi(oi_delta, price_delta)

    # 6. Bollinger mean reversion
    bb_up, bb_lo = float(bb["upper"].iloc[-1]), float(bb["lower"].iloc[-1])
    s_meanrev = 1 if last_close < bb_lo else (-1 if last_close > bb_up else 0)

    scores = {
        "trend": s_trend,
        "momentum": s_momentum,
        "cvd": s_cvd,
        "funding": s_funding,
        "oi": s_oi,
        "meanrev": s_meanrev,
    }
    raw_net = float(sum(scores.values()))
    net = apply_regime(raw_net, regime_bull)

    reasons = []
    if s_trend:
        reasons.append("ST yukari" if s_trend > 0 else "ST asagi")
    if s_rsi_th:
        reasons.append(f"RSI {r_last:.0f}")
    if s_rsi_div:
        reasons.append("RSI bull-div" if s_rsi_div > 0 else "RSI bear-div")
    if s_cvd:
        reasons.append("CVD bull-div" if s_cvd > 0 else "CVD bear-div")
    if s_funding:
        reasons.append(f"Funding {f_ann:+.0f}%/y")
    if s_oi:
        reasons.append(f"OI {oi_delta:+.1f}% / Px {price_delta:+.1f}%")
    if s_meanrev:
        reasons.append("BB alt asim" if s_meanrev > 0 else "BB ust asim")

    a = atr(df, 14)
    return {
        "time": df.index[-1].isoformat(),
        "close": last_close,
        "rsi": r_last,
        "st_dir": st_dir,
        "st_line": float(st["st"].iloc[-1]),
        "bb_upper": bb_up,
        "bb_lower": bb_lo,
        "bb_pct_b": float(bb["pct_b"].iloc[-1]),
        "atr_pct": float(a.iloc[-1] / last_close * 100.0) if last_close else float("nan"),
        "funding_rate": funding_rate,
        "funding_ann": f_ann,
        "oi_delta_24h": oi_delta,
        "price_delta_24h": price_delta,
        "scores": scores,
        "raw_net": raw_net,
        "net": net,
        "regime_bull": regime_bull,
        "reasons": reasons,
    }


def _infer_tf_hours(df: pd.DataFrame) -> float:
    if len(df) < 3:
        return 4.0
    d = pd.Series(df.index).diff().dropna().median()
    return max(d.total_seconds() / 3600.0, 1e-6)


def build_signals_v2(df: pd.DataFrame, regime_mask: Optional[pd.Series] = None,
                     funding_interval_h: float = 8.0) -> pd.DataFrame:
    """Tum seri icin vektorize v2 skorlari (backtest)."""
    close = df["close"]
    out = pd.DataFrame(index=df.index)
    st = supertrend(df)
    r = rsi(close)
    bb = bollinger(close)

    out["trend"] = np.where(st["dir"] == 1, 1, np.where(st["dir"] == -1, -1, 0))

    rsi_th = np.where(r < RSI_LOW, 1, np.where(r > RSI_HIGH, -1, 0))
    rsi_div = rolling_divergence(df["low"], df["high"], r).to_numpy()
    out["momentum"] = np.clip(rsi_th + rsi_div, -1, 1)

    if "cvd" in df.columns and df["cvd"].notna().any():
        out["cvd"] = rolling_divergence(df["low"], df["high"], df["cvd"]).to_numpy()
    else:
        out["cvd"] = 0

    if "funding" in df.columns:
        f_ann = df["funding"] * (24.0 / funding_interval_h) * 365.0 * 100.0
        out["funding"] = np.where(f_ann < FUNDING_LONG_TH, 1, np.where(f_ann > FUNDING_SHORT_TH, -1, 0))
    else:
        out["funding"] = 0

    tfh = _infer_tf_hours(df)
    bars_24h = max(1, int(round(24 / tfh)))
    px_d = close.pct_change(bars_24h) * 100.0
    if "oi" in df.columns and df["oi"].notna().any():
        oi_d = df["oi"].pct_change(bars_24h, fill_method=None) * 100.0
        up = (oi_d >= OI_DELTA_TH)
        out["oi"] = np.where(up & (px_d >= PRICE_DELTA_TH), 1, np.where(up & (px_d <= -PRICE_DELTA_TH), -1, 0))
    else:
        out["oi"] = 0

    out["meanrev"] = np.where(close < bb["lower"], 1, np.where(close > bb["upper"], -1, 0))

    # Isinma donemi: indikatorler hazir degilken skor 0
    warm = r.isna() | bb["mid"].isna() | st["st"].isna()
    out.loc[warm, CATEGORY_KEYS] = 0

    out["raw_net"] = out[CATEGORY_KEYS].sum(axis=1).astype(float)
    if regime_mask is None:
        regime_mask = pd.Series(True, index=df.index)
    bull = regime_mask.reindex(df.index).fillna(True).astype(bool)
    out["regime_bull"] = bull
    out["net"] = np.where((~bull) & (out["raw_net"] > 0), out["raw_net"] * BEAR_LONG_DAMPING, out["raw_net"])
    return out


def build_signals_v1(df: pd.DataFrame, regime_mask: Optional[pd.Series] = None) -> pd.DataFrame:
    """Eski basit motor (karsilastirma icin): SuperTrend + MACD hist + RSI esik, ADX>20 filtresi."""
    close = df["close"]
    out = pd.DataFrame(index=df.index)
    st = supertrend(df)
    m = macd(close)
    r = rsi(close)
    a = adx(df)
    out["trend"] = np.where(st["dir"] == 1, 1, -1)
    out["macd"] = np.where(m["hist"] > 0, 1, np.where(m["hist"] < 0, -1, 0))
    out["rsi"] = np.where(r < RSI_LOW, 1, np.where(r > RSI_HIGH, -1, 0))
    trending = (a["adx"] > 20).to_numpy()
    raw = out[["trend", "macd", "rsi"]].sum(axis=1).astype(float)
    raw = np.where(trending, raw, 0.0)
    warm = r.isna() | st["st"].isna() | m["signal"].isna()
    raw = np.where(warm, 0.0, raw)
    out["raw_net"] = raw
    if regime_mask is None:
        regime_mask = pd.Series(True, index=df.index)
    bull = regime_mask.reindex(df.index).fillna(True).astype(bool)
    out["regime_bull"] = bull
    out["net"] = np.where((~bull) & (out["raw_net"] > 0), out["raw_net"] * BEAR_LONG_DAMPING, out["raw_net"])
    return out


# ---------------------------------------------------------------------------
# Backtest
# ---------------------------------------------------------------------------

def backtest_one(
    df: pd.DataFrame,
    sig: pd.DataFrame,
    entry_th: float = STRONG_TH,
    exit_th: float = 1.0,
    max_hold: int = 30,
    fee_bps: float = 5.0,
    slippage_bps: float = 2.0,
    funding_interval_h: float = 8.0,
    regime_exit: bool = True,
) -> Dict[str, Any]:
    """
    Tek coin backtest.
    - Giris: net >= entry_th long, net <= -entry_th short (bar kapanisinda karar,
      sonraki bar getirisi kazanilir -> look-ahead yok)
    - Cikis: sinyal flip (ters yonde net >= exit_th), max_hold bar, rejim cikisi
      (long acikken BTC rejimi bear'e donerse)
    - Maliyet: her pozisyon degisiminde fee+slippage; funding: long oder, short alir
    """
    close = df["close"].to_numpy(dtype=float)
    net = sig["net"].to_numpy(dtype=float)
    bull = sig["regime_bull"].to_numpy(dtype=bool) if "regime_bull" in sig else np.ones(len(df), bool)
    funding = df["funding"].fillna(0.0).to_numpy(dtype=float) if "funding" in df else np.zeros(len(df))
    n = len(close)
    tfh = _infer_tf_hours(df)
    cost = (fee_bps + slippage_bps) / 10_000.0

    pos = np.zeros(n)
    trades: List[Dict[str, Any]] = []
    cur = 0
    entry_i = -1
    for i in range(n):
        if cur != 0:
            held = i - entry_i
            flip = (cur > 0 and net[i] <= -exit_th) or (cur < 0 and net[i] >= exit_th)
            timeout = held >= max_hold
            reg = regime_exit and cur > 0 and not bull[i]
            if flip or timeout or reg:
                ret = (close[i] / close[entry_i] - 1.0) * cur
                trades.append({
                    "entry_time": df.index[entry_i],
                    "exit_time": df.index[i],
                    "side": "LONG" if cur > 0 else "SHORT",
                    "entry": close[entry_i],
                    "exit": close[i],
                    "bars": held,
                    "gross_ret": ret,
                    "reason": "flip" if flip else ("max_hold" if timeout else "regime"),
                })
                cur = 0
        if cur == 0:
            if net[i] >= entry_th:
                cur, entry_i = 1, i
            elif net[i] <= -entry_th:
                cur, entry_i = -1, i
        pos[i] = cur

    # Bar bazli getiriler (pozisyon i'de alinir, i+1 getirisi kazanilir)
    rets = np.zeros(n)
    if n > 1:
        px_ret = np.diff(close) / close[:-1]
        rets[1:] = pos[:-1] * px_ret
        turn = np.abs(np.diff(np.concatenate([[0.0], pos])))
        rets -= turn * cost
        # funding: bar basina oransal (bar_saat / funding_aralik)
        rets[1:] -= pos[:-1] * funding[:-1] * (tfh / funding_interval_h)

    bar_ret = pd.Series(rets, index=df.index)
    for t in trades:
        t["net_ret"] = t["gross_ret"] - 2 * cost
    return {"bar_returns": bar_ret, "trades": trades, "positions": pd.Series(pos, index=df.index)}


def perf_stats(bar_ret: pd.Series, trades: List[Dict[str, Any]]) -> Dict[str, float]:
    if bar_ret.empty:
        return {}
    daily = bar_ret.resample("1D").sum()
    eq = (1 + bar_ret).cumprod()
    dd = (eq / eq.cummax() - 1.0).min()
    sd = daily.std(ddof=0)
    sharpe = float(daily.mean() / sd * math.sqrt(365)) if sd > 0 else 0.0
    wins = [t for t in trades if t["net_ret"] > 0]
    return {
        "total_return_pct": float((eq.iloc[-1] - 1) * 100.0),
        "sharpe": sharpe,
        "max_dd_pct": float(dd * 100.0),
        "trades": len(trades),
        "hit_rate_pct": float(len(wins) / len(trades) * 100.0) if trades else 0.0,
        "avg_trade_pct": float(np.mean([t["net_ret"] for t in trades]) * 100.0) if trades else 0.0,
    }


# ---------------------------------------------------------------------------
# Evren / funding harvest
# ---------------------------------------------------------------------------

def build_scan_universe(limit: int = 100) -> List[Dict[str, Any]]:
    """24s quote volume'e gore sirali top N USDT-M perpetual (aktif, stable olmayan)."""
    info = http_get(f"{FAPI}/fapi/v1/exchangeInfo")
    perps = {}
    for s in info.get("symbols", []):
        if (
            s.get("contractType") == "PERPETUAL"
            and s.get("quoteAsset") == "USDT"
            and s.get("status") == "TRADING"
            and s.get("baseAsset") not in STABLE_BASES
        ):
            perps[s["symbol"]] = s["baseAsset"]
    tickers = http_get(f"{FAPI}/fapi/v1/ticker/24hr")
    rows = []
    for t in tickers:
        sym = t.get("symbol")
        if sym in perps:
            rows.append({
                "id": sym,
                "symbol": f"{perps[sym]}/USDT:USDT",
                "base": perps[sym],
                "last": float(t.get("lastPrice", 0) or 0),
                "quote_volume": float(t.get("quoteVolume", 0) or 0),
                "chg_24h": float(t.get("priceChangePercent", 0) or 0),
            })
    rows.sort(key=lambda x: x["quote_volume"], reverse=True)
    return rows[:limit]


def fetch_premium_index() -> Dict[str, Dict[str, Any]]:
    """Tum perp'ler icin guncel funding orani + sonraki funding zamani."""
    data = http_get(f"{FAPI}/fapi/v1/premiumIndex")
    out = {}
    for d in data:
        try:
            out[d["symbol"]] = {
                "funding": float(d.get("lastFundingRate", 0) or 0),
                "mark": float(d.get("markPrice", 0) or 0),
                "next_funding": int(d.get("nextFundingTime", 0) or 0),
            }
        except (TypeError, ValueError):
            continue
    return out


def fetch_funding_intervals() -> Dict[str, float]:
    """Varsayilan 8 saatten farkli funding araligi olan semboller (4h/1h)."""
    try:
        data = http_get(f"{FAPI}/fapi/v1/fundingInfo")
        return {d["symbol"]: float(d.get("fundingIntervalHours", 8) or 8) for d in data}
    except Exception as exc:  # noqa: BLE001
        log.debug("fundingInfo alinamadi: %s", exc)
        return {}


def fetch_spot_volumes() -> Dict[str, float]:
    """Spot USDT pariteleri ve 24s quote hacimleri (spot eslenik kontrolu)."""
    data = http_get(f"{SPOT_API}/api/v3/ticker/24hr", {"type": "MINI"})
    out = {}
    for t in data:
        sym = t.get("symbol", "")
        if sym.endswith("USDT"):
            try:
                out[sym] = float(t.get("quoteVolume", 0) or 0)
            except (TypeError, ValueError):
                pass
    return out


def fetch_funding_history_volatility(sym_id: str, days: int = HARVEST_DAYS,
                                     interval_h: float = 8.0) -> Dict[str, float]:
    """Son `days` gunluk funding gecmisinden ortalama/std/pozitif% ve stabilite skoru."""
    start = int(time.time() * 1000) - days * 86_400_000
    data = http_get(f"{FAPI}/fapi/v1/fundingRate", {"symbol": sym_id, "startTime": start, "limit": 1000})
    rates = np.array([float(d["fundingRate"]) for d in data], dtype=float) if data else np.array([])
    if len(rates) < 5:
        return {"n": len(rates), "mean": float("nan"), "std": float("nan"), "pos_pct": float("nan"),
                "ann_mean": float("nan"), "stability": 0.0, "score": 0.0}
    mean = float(rates.mean())
    std = float(rates.std(ddof=0))
    pos_pct = float((rates > 0).mean() * 100.0)
    ann_mean = funding_annualized(mean, interval_h)
    # Stabilite: pozitif oran agirlikli, degisim katsayisi ile cezali (0..1)
    cv = std / abs(mean) if mean != 0 else 10.0
    stability = (pos_pct / 100.0) / (1.0 + cv)
    score = max(ann_mean, 0.0) * stability
    return {"n": int(len(rates)), "mean": mean, "std": std, "pos_pct": pos_pct,
            "ann_mean": ann_mean, "stability": float(stability), "score": float(score)}


def run_funding_harvest(universe_all: Optional[List[Dict[str, Any]]] = None,
                        premium: Optional[Dict[str, Dict[str, Any]]] = None,
                        intervals: Optional[Dict[str, float]] = None) -> List[Dict[str, Any]]:
    """
    Delta-notr funding harvest adaylari (spot long + perp short).
    Filtreler: pozitif funding, spot eslenigi var, perp+spot likidite esikleri.
    """
    universe_all = universe_all if universe_all is not None else build_scan_universe(400)
    premium = premium if premium is not None else fetch_premium_index()
    intervals = intervals if intervals is not None else fetch_funding_intervals()
    spot = fetch_spot_volumes()

    cands = []
    for u in universe_all:
        p = premium.get(u["id"])
        if not p or p["funding"] <= 0:
            continue
        spot_sym = f"{u['base']}USDT"
        if spot_sym not in spot:
            continue
        if u["quote_volume"] < HARVEST_MIN_QUOTE_VOL or spot[spot_sym] < HARVEST_MIN_SPOT_VOL:
            continue
        ih = intervals.get(u["id"], 8.0)
        cands.append({**u, "funding": p["funding"], "interval_h": ih,
                      "funding_ann_now": funding_annualized(p["funding"], ih),
                      "spot_volume": spot[spot_sym], "next_funding": p["next_funding"]})

    cands.sort(key=lambda x: x["funding_ann_now"], reverse=True)
    cands = cands[:HARVEST_CANDIDATES]
    log.info("Funding harvest: %d aday volatilite analizinde", len(cands))

    results = []
    for c in cands:
        try:
            vol = fetch_funding_history_volatility(c["id"], HARVEST_DAYS, c["interval_h"])
        except Exception as exc:  # noqa: BLE001
            log.debug("funding vol %s: %s", c["id"], exc)
            continue
        results.append({**c, **{f"hist_{k}": v for k, v in vol.items()}})
        time.sleep(0.05)
    results = [r for r in results if r.get("hist_score", 0) > 0]
    results.sort(key=lambda x: x["hist_score"], reverse=True)
    return results[:HARVEST_TOP]


# ---------------------------------------------------------------------------
# Tarama
# ---------------------------------------------------------------------------

def scan_symbol(u: Dict[str, Any], timeframe: str, premium: Dict[str, Dict[str, Any]],
                intervals: Dict[str, float], regime_bull: bool) -> Optional[Dict[str, Any]]:
    try:
        df = fetch_cvd_binance(u["id"], timeframe, limit=300)
        if df.empty or len(df) < 60:
            return None
        try:
            oi = fetch_oi_history_rest(u["id"], "1h", 30)
        except Exception as exc:  # noqa: BLE001
            log.debug("OI %s: %s", u["id"], exc)
            oi = None
        p = premium.get(u["id"], {})
        res = scan_last_bar_v2(df, p.get("funding"), oi, regime_bull, intervals.get(u["id"], 8.0))
        res.update({
            "symbol": u["symbol"],
            "id": u["id"],
            "base": u["base"],
            "quote_volume": u["quote_volume"],
            "chg_24h_ticker": u["chg_24h"],
        })
        return res
    except Exception as exc:  # noqa: BLE001
        log.warning("%s tarama hatasi: %s", u.get("id"), exc)
        return None


def run_scan(limit: int = 100, timeframe: str = DEFAULT_TIMEFRAME, workers: int = 4,
             progress: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    t0 = time.time()
    regime = fetch_btc_regime()
    log.info("BTC rejim: %s (fiyat %.0f, EMA200 %.0f)", regime["regime"], regime["price"], regime["ema200"])
    universe_all = build_scan_universe(400)
    universe = universe_all[:limit]
    premium = fetch_premium_index()
    intervals = fetch_funding_intervals()
    log.info("Evren: %d sembol, timeframe %s", len(universe), timeframe)
    if progress is not None:
        progress.update({"total": len(universe), "done": 0, "phase": "sinyal taramasi"})

    results: List[Dict[str, Any]] = []
    with cf.ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(scan_symbol, u, timeframe, premium, intervals, regime["bull"]): u for u in universe}
        for f in cf.as_completed(futs):
            r = f.result()
            if r:
                results.append(r)
            if progress is not None:
                progress["done"] = progress.get("done", 0) + 1

    if progress is not None:
        progress["phase"] = "funding harvest"
    try:
        harvest = run_funding_harvest(universe_all, premium, intervals)
    except Exception as exc:  # noqa: BLE001
        log.warning("Funding harvest hatasi: %s", exc)
        harvest = []

    def top(key: str, positive: bool, n: int = 15) -> List[Dict[str, Any]]:
        if positive:
            sel = [r for r in results if r[key] >= STRONG_TH]
            sel.sort(key=lambda r: (r[key], r["quote_volume"]), reverse=True)
        else:
            sel = [r for r in results if r[key] <= -STRONG_TH]
            sel.sort(key=lambda r: (r[key], -r["quote_volume"]))
        return sel[:n]

    out = {
        "generated_at": time.time(),
        "generated_iso": now_utc().isoformat(),
        "elapsed_s": time.time() - t0,
        "timeframe": timeframe,
        "limit": limit,
        "scanned": len(results),
        "regime": regime,
        "strong_long": top("net", True),
        "strong_short": top("net", False),
        "raw_long": top("raw_net", True),
        "raw_short": top("raw_net", False),
        "harvest": harvest,
        "all": results,
    }
    return out


# ---------------------------------------------------------------------------
# Cikti: HTML / ozet / bildirim
# ---------------------------------------------------------------------------

def _f(x: Any, nd: int = 2, suffix: str = "", sign: bool = False) -> str:
    try:
        if x is None or (isinstance(x, float) and math.isnan(x)):
            return "–"
        fmt = f"{{:{'+' if sign else ''},.{nd}f}}"
        return fmt.format(float(x)) + suffix
    except (TypeError, ValueError):
        return "–"


def _price(x: float) -> str:
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return "–"
    if x >= 1000:
        return f"{x:,.1f}"
    if x >= 1:
        return f"{x:,.3f}"
    if x >= 0.01:
        return f"{x:.5f}"
    return f"{x:.8f}"


def _vol(x: float) -> str:
    if x >= 1e9:
        return f"{x / 1e9:.2f}B"
    if x >= 1e6:
        return f"{x / 1e6:.1f}M"
    return f"{x / 1e3:.0f}K"


def _score_chips(scores: Dict[str, int]) -> str:
    short = {"trend": "TR", "momentum": "MO", "cvd": "CV", "funding": "FU", "oi": "OI", "meanrev": "BB"}
    parts = []
    for k in CATEGORY_KEYS:
        v = scores.get(k, 0)
        cls = "pos" if v > 0 else ("neg" if v < 0 else "zero")
        parts.append(f'<span class="chip {cls}" title="{html.escape(CATEGORY_LABELS[k])}: {v:+d}">{short[k]}</span>')
    return "".join(parts)


def _signal_table(rows: List[Dict[str, Any]], key: str, empty_msg: str) -> str:
    if not rows:
        return f'<p class="empty">{html.escape(empty_msg)}</p>'
    head = (
        "<tr><th>#</th><th>Sembol</th><th>Fiyat</th><th>24s %</th><th>Net</th><th>Ham</th>"
        "<th>Kategoriler</th><th>RSI</th><th>Funding/y</th><th>OI 24s</th><th>ATR%</th><th>Hacim</th><th>Gerekce</th></tr>"
    )
    body = []
    for i, r in enumerate(rows, 1):
        net_cls = "pos" if r[key] > 0 else "neg"
        tv = f"https://www.tradingview.com/chart/?symbol=BINANCE:{r['id']}.P"
        body.append(
            "<tr>"
            f"<td>{i}</td>"
            f'<td class="sym"><a href="{tv}" target="_blank" rel="noopener">{html.escape(r["base"])}</a></td>'
            f"<td>{_price(r['close'])}</td>"
            f'<td class="{"pos" if r.get("price_delta_24h", 0) >= 0 else "neg"}">{_f(r.get("price_delta_24h"), 1, "%", True)}</td>'
            f'<td class="{net_cls} b">{_f(r["net"], 1, sign=True)}</td>'
            f"<td>{_f(r['raw_net'], 0, sign=True)}</td>"
            f"<td>{_score_chips(r['scores'])}</td>"
            f"<td>{_f(r['rsi'], 0)}</td>"
            f"<td>{_f(r['funding_ann'], 1, '%', True)}</td>"
            f"<td>{_f(r['oi_delta_24h'], 1, '%', True)}</td>"
            f"<td>{_f(r['atr_pct'], 1, '%')}</td>"
            f"<td>{_vol(r['quote_volume'])}</td>"
            f'<td class="why">{html.escape(", ".join(r["reasons"]))}</td>'
            "</tr>"
        )
    return f'<div class="tw"><table>{head}{"".join(body)}</table></div>'


def _harvest_table(rows: List[Dict[str, Any]]) -> str:
    if not rows:
        return '<p class="empty">Filtreleri gecen funding harvest adayi yok.</p>'
    head = (
        "<tr><th>#</th><th>Sembol</th><th>Simdi/y</th><th>30g ort/y</th><th>Pozitif %</th>"
        "<th>Stabilite</th><th>Skor</th><th>Aralik</th><th>Perp hacim</th><th>Spot hacim</th></tr>"
    )
    body = []
    for i, r in enumerate(rows, 1):
        stab = r.get("hist_stability", 0.0)
        body.append(
            "<tr>"
            f"<td>{i}</td>"
            f'<td class="sym">{html.escape(r["base"])}</td>'
            f'<td class="pos">{_f(r["funding_ann_now"], 1, "%")}</td>'
            f"<td>{_f(r.get('hist_ann_mean'), 1, '%')}</td>"
            f"<td>{_f(r.get('hist_pos_pct'), 0, '%')}</td>"
            f'<td><div class="bar"><span style="width:{min(stab, 1) * 100:.0f}%"></span></div>{_f(stab, 2)}</td>'
            f"<td class=\"b\">{_f(r.get('hist_score'), 1)}</td>"
            f"<td>{int(r.get('interval_h', 8))}s</td>"
            f"<td>{_vol(r['quote_volume'])}</td>"
            f"<td>{_vol(r['spot_volume'])}</td>"
            "</tr>"
        )
    return f'<div class="tw"><table>{head}{"".join(body)}</table></div>'


DASHBOARD_CSS = """
:root{--bg:#0d1117;--card:#161b22;--line:#30363d;--fg:#e6edf3;--mut:#8b949e;--pos:#3fb950;--neg:#f85149;--acc:#58a6ff;--warn:#d29922}
@media (prefers-color-scheme: light){:root{--bg:#f6f8fa;--card:#fff;--line:#d0d7de;--fg:#1f2328;--mut:#656d76;--pos:#1a7f37;--neg:#cf222e;--acc:#0969da;--warn:#9a6700}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--line)}
h1{font-size:18px;margin:0}h2{font-size:15px;margin:0 0 8px}main{padding:16px 20px;max-width:1500px;margin:0 auto}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:16px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 12px}.kpi .l{color:var(--mut);font-size:12px}.kpi .v{font-size:20px;font-weight:600}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;margin-bottom:16px}
.grid2{display:grid;grid-template-columns:1fr;gap:16px}@media(min-width:1200px){.grid2{grid-template-columns:1fr 1fr}}
.tw{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}
th,td{padding:5px 7px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}th{color:var(--mut);font-weight:500;position:sticky;top:0;background:var(--card)}
td.sym,th:nth-child(2){text-align:left}td.why{text-align:left;color:var(--mut);white-space:normal;min-width:180px}
a{color:var(--acc);text-decoration:none}.pos{color:var(--pos)}.neg{color:var(--neg)}.b{font-weight:700}
.chip{display:inline-block;width:24px;font-size:10px;text-align:center;border-radius:3px;margin-left:2px;padding:1px 0;border:1px solid var(--line);color:var(--mut)}
.chip.pos{background:color-mix(in srgb,var(--pos) 25%,transparent);color:var(--fg)}.chip.neg{background:color-mix(in srgb,var(--neg) 25%,transparent);color:var(--fg)}
.btn{background:var(--acc);color:#fff;border:0;border-radius:6px;padding:8px 14px;font-weight:600;cursor:pointer}.btn:disabled{opacity:.6;cursor:wait}
.status{color:var(--mut);font-size:12px}.warn{border-left:4px solid var(--warn);padding:10px 12px;background:var(--card);border-radius:6px;margin-bottom:16px;font-size:13px}
.empty{color:var(--mut);font-style:italic}.bar{display:inline-block;width:50px;height:6px;background:var(--line);border-radius:3px;margin-right:6px;vertical-align:middle}
.bar span{display:block;height:100%;background:var(--pos);border-radius:3px}.legend{color:var(--mut);font-size:12px;margin-top:6px}
"""

DASHBOARD_JS = """
const GENERATED_AT = __GENERATED_AT__ * 1000;
const AUTO_REFRESH_MS = __AUTO_REFRESH__ * 60 * 1000;
const STALE_MS = __STALE__ * 60 * 1000;
const statusEl = () => document.getElementById('scan-status');
const btnEl = () => document.getElementById('rescan');
let polling = false;

function setStatus(t){ const s = statusEl(); if (s) s.textContent = t; }
function ageText(){ const m = Math.round((Date.now()-GENERATED_AT)/60000); return m < 1 ? 'az once' : m + ' dk once'; }

async function getStatus(){ const r = await fetch('/api/status', {cache:'no-store'}); return r.json(); }

async function rescan(){
  const b = btnEl(); if (b) b.disabled = true;
  try {
    const before = await getStatus();
    const r = await fetch('/api/scan', {cache:'no-store'});
    const j = await r.json();
    setStatus(j.status === 'started' ? 'Tarama basladi...' : 'Tarama zaten calisiyor...');
    pollUntilDone(before.html_mtime || 0);
  } catch(e) {
    setStatus('Sunucuya ulasilamadi (http://localhost:8765 uzerinden actiginizdan emin olun).');
    if (b) b.disabled = false;
  }
}

async function pollUntilDone(startMtime){
  if (polling) return; polling = true;
  const b = btnEl(); if (b) b.disabled = true;
  const tick = async () => {
    try {
      const s = await getStatus();
      if (s.running) {
        const p = s.progress || {};
        const pr = p.total ? ` ${p.done||0}/${p.total}` : '';
        setStatus(`Taraniyor (${p.phase||'...'}${pr}) – ${Math.round(s.elapsed||0)} sn`);
        setTimeout(tick, 4000); return;
      }
      if ((s.html_mtime||0) > startMtime) { setStatus('Tamamlandi, yenileniyor...'); location.reload(); return; }
      if (s.last_error) { setStatus('Tarama hatasi: ' + s.last_error); polling = false; if (b) b.disabled = false; return; }
      setTimeout(tick, 4000);
    } catch(e) { setStatus('Durum alinamadi, tekrar denenecek...'); setTimeout(tick, 8000); }
  };
  tick();
}

async function autoScanIfStale(){
  try {
    const s = await getStatus();
    if (s.running) { pollUntilDone(s.html_mtime || 0); return; }
    if (Date.now() - GENERATED_AT > STALE_MS) { setStatus('Veri ' + ageText() + ' – otomatik tarama tetikleniyor...'); rescan(); }
    else setStatus('Veri ' + ageText() + ' guncellendi.');
  } catch(e) { setStatus('Statik mod (sunucu yok) – veri ' + ageText()); }
}

setInterval(() => { if (!polling) location.reload(); }, AUTO_REFRESH_MS);
setInterval(() => { if (!polling) setStatus('Veri ' + ageText() + ' guncellendi.'); }, 60000);
document.addEventListener('DOMContentLoaded', () => {
  const b = btnEl(); if (b) b.addEventListener('click', rescan);
  autoScanIfStale();
});
"""


def write_dashboard_html(data: Dict[str, Any], path: Path = DASHBOARD_HTML) -> Path:
    reg = data["regime"]
    gen = datetime.fromtimestamp(data["generated_at"]).strftime("%Y-%m-%d %H:%M")
    reg_cls = "pos" if reg["bull"] else "neg"
    n_long = len(data["strong_long"])
    n_short = len(data["strong_short"])
    best_h = data["harvest"][0] if data["harvest"] else None

    kpis = f"""
    <div class="kpis">
      <div class="kpi"><div class="l">BTC fiyat</div><div class="v">${reg['price']:,.0f}</div>
        <div class="l {'pos' if reg['chg_24h'] >= 0 else 'neg'}">{reg['chg_24h']:+.2f}% (gunluk kapanisa gore)</div></div>
      <div class="kpi"><div class="l">BTC rejim</div><div class="v {reg_cls}">{'BOGA' if reg['bull'] else 'AYI'}</div>
        <div class="l">EMA200 ${reg['ema200']:,.0f} ({reg['dist_pct']:+.1f}%)</div></div>
      <div class="kpi"><div class="l">Guclu long / short</div><div class="v"><span class="pos">{n_long}</span> / <span class="neg">{n_short}</span></div>
        <div class="l">|net| ≥ {STRONG_TH:.0f}, {data['scanned']} sembol</div></div>
      <div class="kpi"><div class="l">En iyi harvest</div><div class="v">{html.escape(best_h['base']) if best_h else '–'}</div>
        <div class="l">{_f(best_h['hist_ann_mean'], 1, '%/y 30g ort') if best_h else 'aday yok'}</div></div>
      <div class="kpi"><div class="l">Son tarama</div><div class="v" style="font-size:16px">{gen}</div>
        <div class="l">{data['timeframe']} bar · {data['elapsed_s']:.0f} sn</div></div>
    </div>"""

    regime_note = "" if reg["bull"] else (
        '<div class="warn">BTC gunluk EMA200 altinda: long skorlar %50 sonumlendi. '
        'Filtresiz long adaylari "Ham Long" tablosunda.</div>'
    )

    js = (DASHBOARD_JS.replace("__GENERATED_AT__", f"{data['generated_at']:.0f}")
          .replace("__AUTO_REFRESH__", str(AUTO_REFRESH_MIN))
          .replace("__STALE__", str(AUTO_SCAN_STALE_MIN)))

    doc = f"""<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Perp Sinyal Radari</title><style>{DASHBOARD_CSS}</style></head>
<body>
<header>
  <h1>Binance USDT-M Perp Sinyal Radari <span class="status">v2 · 6 kategori · ±6</span></h1>
  <div><span id="scan-status" class="status">...</span>&nbsp;
  <button id="rescan" class="btn">Yeniden Tara</button></div>
</header>
<main>
<div class="warn"><b>Karar destek aracidir, trade botu degildir.</b> Backtest (365g) Sharpe ≈ -0.7: sinyaller tek basina alfa
garantisi vermez. Paper-trade defteri tut; 30+ islemde isabet %55'in altindaysa sadece "buna bak" radari olarak kullan.</div>
{kpis}
{regime_note}
<div class="grid2">
  <section class="card"><h2 class="pos">Guclu Long (rejim filtreli)</h2>
    {_signal_table(data['strong_long'], 'net', 'Su an guclu long sinyali yok.')}</section>
  <section class="card"><h2 class="neg">Guclu Short (rejim filtreli)</h2>
    {_signal_table(data['strong_short'], 'net', 'Su an guclu short sinyali yok.')}</section>
  <section class="card"><h2>Ham Long (rejim filtresiz)</h2>
    {_signal_table(data['raw_long'], 'raw_net', 'Ham long sinyali yok.')}</section>
  <section class="card"><h2>Ham Short (rejim filtresiz)</h2>
    {_signal_table(data['raw_short'], 'raw_net', 'Ham short sinyali yok.')}</section>
</div>
<section class="card"><h2>Funding Harvest (spot long + perp short, stabilite agirlikli)</h2>
  {_harvest_table(data['harvest'])}
  <div class="legend">Skor = max(30g ort. yillik funding, 0) × stabilite; stabilite = pozitif% / (1 + std/ort).
  Filtre: perp hacim ≥ {_vol(HARVEST_MIN_QUOTE_VOL)}, spot hacim ≥ {_vol(HARVEST_MIN_SPOT_VOL)}, spot eslenik mevcut.</div>
</section>
<div class="legend">Kategoriler: TR=SuperTrend(10,3) · MO=RSI(14) esik/divergence · CV=CVD divergence · FU=funding yillik
(&lt;{FUNDING_LONG_TH:.0f}% long, &gt;+{FUNDING_SHORT_TH:.0f}% short) · OI=24s OI buildup · BB=Bollinger(20,2).
Sembole tiklayinca TradingView acilir. Sayfa {AUTO_REFRESH_MIN} dk'da bir yenilenir; veri {AUTO_SCAN_STALE_MIN} dk'dan eskiyse otomatik taranir.</div>
</main>
<script>{js}</script>
</body></html>"""
    tmp = path.with_suffix(".html.tmp")
    tmp.write_text(doc, encoding="utf-8")
    os.replace(tmp, path)
    return path


def write_placeholder_html(path: Path = DASHBOARD_HTML) -> None:
    """Ilk calistirmada henuz tarama yokken gosterilen sayfa (auto-scan tetikler)."""
    data = {
        "generated_at": 0.0, "elapsed_s": 0.0, "timeframe": DEFAULT_TIMEFRAME, "scanned": 0,
        "regime": {"price": 0.0, "chg_24h": 0.0, "bull": True, "ema200": 0.0, "dist_pct": 0.0},
        "strong_long": [], "strong_short": [], "raw_long": [], "raw_short": [], "harvest": [],
    }
    write_dashboard_html(data, path)


def write_summary_md(data: Dict[str, Any], path: Path = SUMMARY_MD) -> Path:
    reg = data["regime"]
    gen = datetime.fromtimestamp(data["generated_at"]).strftime("%d.%m.%Y %H:%M")

    def names(rows: List[Dict[str, Any]], key: str, n: int = 5) -> str:
        if not rows:
            return "yok"
        return ", ".join(f"{r['base']} ({r[key]:+.1f})" for r in rows[:n])

    all_rows = data.get("all", [])
    avg_net = float(np.mean([r["raw_net"] for r in all_rows])) if all_rows else 0.0
    st_up = sum(1 for r in all_rows if r["st_dir"] == 1)
    hot_funding = sorted(
        [r for r in all_rows if not math.isnan(r["funding_ann"] or float("nan"))],
        key=lambda r: r["funding_ann"], reverse=True,
    )[:3]
    neg_funding = sorted(
        [r for r in all_rows if not math.isnan(r["funding_ann"] or float("nan"))],
        key=lambda r: r["funding_ann"],
    )[:3]
    harvest = data.get("harvest", [])

    breadth = (st_up / len(all_rows) * 100.0) if all_rows else 0.0
    if breadth >= 60:
        breadth_txt = "piyasa genisliginde yukari trend baskin"
    elif breadth <= 40:
        breadth_txt = "piyasa genisliginde asagi trend baskin"
    else:
        breadth_txt = "piyasa genisligi karisik, net bir yon yok"

    lines = [
        f"# Perp Sinyal Radari – Ozet ({gen})",
        "",
        "## Piyasa rejimi",
        f"BTC fiyati **${reg['price']:,.0f}**, gunluk EMA200 **${reg['ema200']:,.0f}** "
        f"({reg['dist_pct']:+.1f}%). Rejim: **{reg['regime']}**. "
        + ("Bu nedenle long sinyallerin skoru %50 sonumlendi; filtresiz long adaylari ayrica listelendi. "
           if not reg["bull"] else "Rejim filtresi long sinyalleri sonumlemiyor. ")
        + f"Taranan {data['scanned']} kontratin %{breadth:.0f}'inde SuperTrend yukari; {breadth_txt}. "
        f"Ortalama ham net skor {avg_net:+.2f}.",
        "",
        "## Yon sinyalleri",
        f"- **Guclu long ({len(data['strong_long'])}):** {names(data['strong_long'], 'net')}",
        f"- **Guclu short ({len(data['strong_short'])}):** {names(data['strong_short'], 'net')}",
        f"- **Ham long (filtresiz):** {names(data['raw_long'], 'raw_net')}",
        f"- **Ham short (filtresiz):** {names(data['raw_short'], 'raw_net')}",
        "",
        "Skor, 6 bagimsiz kategorinin (SuperTrend, RSI esik/divergence, CVD divergence, funding, "
        "OI buildup, Bollinger) toplamidir; |net| ≥ 3 guclu kabul edilir. Yuksek skor, birden fazla "
        "bagimsiz gostergenin ayni yonu isaret ettigi anlamina gelir; kesin yon tahmini degildir.",
        "",
        "## Funding / pozisyonlanma",
        "- En yuksek yillik funding: "
        + (", ".join(f"{r['base']} {r['funding_ann']:+.0f}%" for r in hot_funding) or "yok")
        + " (kalabalik long, squeeze riski).",
        "- En negatif funding: "
        + (", ".join(f"{r['base']} {r['funding_ann']:+.0f}%" for r in neg_funding) or "yok")
        + " (kalabalik short, short squeeze potansiyeli).",
        "",
        "## Funding harvest",
        (
            "Stabilite agirlikli ilk adaylar: "
            + ", ".join(f"{h['base']} (30g ort {h['hist_ann_mean']:.0f}%/y, pozitif %{h['hist_pos_pct']:.0f})"
                        for h in harvest[:5])
            + ". Delta-notr kurulum (spot long + perp short) fiyat riskini sifirlamaz: "
              "funding negatife donebilir, borsa/likidasyon riski ve islem maliyetleri getiriyi eritebilir."
        ) if harvest else "Filtreleri gecen stabil pozitif funding adayi bulunamadi.",
        "",
        "## Nasil okunmali",
        "Guclu tablolardaki bir coin icin once grafigi acin (sembole tiklayin), SuperTrend cizgisini ve "
        "son destek/direnc seviyelerini kontrol edin. Funding ve OI kategorileri pozisyonlanmayi, RSI ve "
        "Bollinger asiri uzamayi, CVD ise agresif alici/satici akisini olcer. Trend ile mean reversion ayni "
        "anda farkli yonu gosteriyorsa sinyal zayiftir. Ham tablolar, rejim filtresi olmasaydi hangi "
        "adaylarin one cikacagini gosterir; ayi rejiminde bunlar daha yuksek risk tasir.",
        "",
        "## Uyari",
        "Bu arac **karar destek** amaclidir, otomatik emir vermez. 365 gunluk backtest Sharpe ≈ -0.7 ile "
        "negatif sonuclandi; sinyaller tek basina alfa garantisi vermez. Her sinyali paper-trade defterine "
        "yazin, 5-10 gun sonra fiyati kontrol edin, 30+ islem sonra isabet oranini olcun. Isabet %55'in "
        "altindaysa sinyalleri yalnizca \"buna bak\" radari olarak kullanin.",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


_WIN_TOAST_PS = r"""
$ErrorActionPreference = 'Stop'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$t = [System.Security.SecurityElement]::Escape($env:CB_TITLE)
$m = [System.Security.SecurityElement]::Escape($env:CB_MSG)
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>$t</text><text>$m</text></binding></visual></toast>")
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show(
    [Windows.UI.Notifications.ToastNotification]::new($xml))
"""


def send_notification(title: str, message: str) -> None:
    """
    Masaustu bildirimi.
      Windows : PowerShell + WinRT toast (ek modul gerektirmez)
      macOS   : osascript
      Diger   : sessizce atlanir
    """
    try:
        if sys.platform == "win32":
            env = {**os.environ, "CB_TITLE": title, "CB_MSG": message}
            subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                 "-Command", _WIN_TOAST_PS],
                check=False, timeout=20, env=env,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        elif sys.platform == "darwin":
            def esc(s: str) -> str:
                return s.replace("\\", "\\\\").replace('"', '\\"')
            script = f'display notification "{esc(message)}" with title "{esc(title)}" sound name "Glass"'
            subprocess.run(["osascript", "-e", script], check=False, timeout=10,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            log.debug("Bildirim atlandi (desteklenmeyen platform): %s - %s", title, message)
    except Exception as exc:  # noqa: BLE001
        log.debug("Bildirim hatasi: %s", exc)


def _json_default(o: Any) -> Any:
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        v = float(o)
        return None if math.isnan(v) else v
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, (pd.Timestamp, datetime)):
        return o.isoformat()
    return str(o)


def _clean_nan(o: Any) -> Any:
    if isinstance(o, float) and math.isnan(o):
        return None
    if isinstance(o, dict):
        return {k: _clean_nan(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_clean_nan(v) for v in o]
    return o


def run_dashboard(limit: int = 100, timeframe: str = DEFAULT_TIMEFRAME, notify: bool = True,
                  progress: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    log.info("Dashboard taramasi basliyor (top %d, %s)", limit, timeframe)
    data = run_scan(limit=limit, timeframe=timeframe, progress=progress)
    if progress is not None:
        progress["phase"] = "cikti yaziliyor"
    write_dashboard_html(data)
    write_summary_md(data)
    SCAN_JSON.write_text(json.dumps(_clean_nan(data), default=_json_default, indent=1), encoding="utf-8")
    log.info(
        "Bitti: %d sembol, %d guclu long, %d guclu short, %d harvest (%.0f sn) -> %s",
        data["scanned"], len(data["strong_long"]), len(data["strong_short"]),
        len(data["harvest"]), data["elapsed_s"], DASHBOARD_HTML,
    )
    if notify:
        top_l = ", ".join(r["base"] for r in data["strong_long"][:3]) or "-"
        top_s = ", ".join(r["base"] for r in data["strong_short"][:3]) or "-"
        send_notification(
            "Perp Sinyal Radari",
            f"BTC {'BOGA' if data['regime']['bull'] else 'AYI'} | L:{len(data['strong_long'])} ({top_l}) "
            f"S:{len(data['strong_short'])} ({top_s})",
        )
    return data


# ---------------------------------------------------------------------------
# HTTP server
# ---------------------------------------------------------------------------

class ScanState:
    def __init__(self, limit: int, timeframe: str):
        self.lock = threading.Lock()
        self.running = False
        self.started_at = 0.0
        self.finished_at = 0.0
        self.last_error: Optional[str] = None
        self.progress: Dict[str, Any] = {}
        self.limit = limit
        self.timeframe = timeframe

    def start(self) -> bool:
        with self.lock:
            if self.running:
                return False
            self.running = True
            self.started_at = time.time()
            self.last_error = None
            self.progress = {"phase": "baslatiliyor", "done": 0, "total": 0}
        threading.Thread(target=self._run, name="scan", daemon=True).start()
        return True

    def _run(self) -> None:
        try:
            run_dashboard(limit=self.limit, timeframe=self.timeframe, notify=True, progress=self.progress)
        except Exception as exc:  # noqa: BLE001
            self.last_error = f"{type(exc).__name__}: {exc}"
            log.error("Tarama hatasi: %s\n%s", exc, traceback.format_exc())
        finally:
            with self.lock:
                self.running = False
                self.finished_at = time.time()

    def status(self) -> Dict[str, Any]:
        mtime = DASHBOARD_HTML.stat().st_mtime if DASHBOARD_HTML.exists() else 0.0
        return {
            "running": self.running,
            "elapsed": (time.time() - self.started_at) if self.running else 0.0,
            "started_at": self.started_at or None,
            "finished_at": self.finished_at or None,
            "html_mtime": mtime,
            "html_mtime_str": fmt_ts(mtime) if mtime else None,
            "last_error": self.last_error,
            "progress": dict(self.progress),
            "limit": self.limit,
            "timeframe": self.timeframe,
        }


def serve_dashboard(port: int = DEFAULT_PORT, limit: int = 100, timeframe: str = DEFAULT_TIMEFRAME,
                    host: str = "127.0.0.1") -> None:
    state = ScanState(limit, timeframe)
    if not DASHBOARD_HTML.exists():
        write_placeholder_html()

    class Handler(BaseHTTPRequestHandler):
        server_version = "CryptoBotDashboard/2.0"

        def log_message(self, fmt: str, *args: Any) -> None:  # server.log'a yonlendir
            log.info("HTTP %s - %s", self.address_string(), fmt % args)

        def _send(self, code: int, body: bytes, ctype: str) -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, obj: Dict[str, Any], code: int = 200) -> None:
            self._send(code, json.dumps(obj, default=_json_default).encode("utf-8"), "application/json; charset=utf-8")

        def do_GET(self) -> None:  # noqa: N802
            path = urlparse(self.path).path
            if path in ("/", "/index.html", "/dashboard.html"):
                if not DASHBOARD_HTML.exists():
                    write_placeholder_html()
                self._send(200, DASHBOARD_HTML.read_bytes(), "text/html; charset=utf-8")
            elif path == "/api/scan":
                started = state.start()
                self._json({"status": "started" if started else "already_running", **state.status()})
            elif path == "/api/status":
                self._json(state.status())
            elif path == "/summary.md":
                body = SUMMARY_MD.read_bytes() if SUMMARY_MD.exists() else b"Henuz ozet yok."
                self._send(200, body, "text/markdown; charset=utf-8")
            elif path == "/api/results":
                body = SCAN_JSON.read_bytes() if SCAN_JSON.exists() else b"{}"
                self._send(200, body, "application/json; charset=utf-8")
            elif path == "/favicon.ico":
                self._send(204, b"", "image/x-icon")
            else:
                self._json({"error": "not found", "path": path}, 404)

        do_POST = do_GET  # /api/scan POST ile de tetiklenebilir

    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.daemon_threads = True
    log.info("Dashboard server: http://localhost:%d/ (limit=%d, tf=%s)", port, limit, timeframe)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        log.info("Server durduruldu")
    finally:
        httpd.server_close()


# ---------------------------------------------------------------------------
# Backtest ana akisi
# ---------------------------------------------------------------------------

def main(args: argparse.Namespace) -> int:
    ex = make_exchange()
    ex.load_markets()
    if args.symbols:
        symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
        symbols = [s if "/" in s else f"{s.replace('USDT', '')}/USDT:USDT" for s in symbols]
    else:
        symbols = [u["symbol"] for u in build_scan_universe(args.limit)]
    log.info("Backtest: %d sembol, %s, %d gun, engine=%s", len(symbols), args.timeframe, args.days, args.engine)

    first_df = None
    all_returns: Dict[str, pd.Series] = {}
    all_trades: List[Dict[str, Any]] = []
    regime_mask_cache: Optional[pd.Series] = None
    per_coin = []

    for i, sym in enumerate(symbols, 1):
        try:
            df = fetch_data(ex, sym, args.timeframe, args.days)
        except Exception as exc:  # noqa: BLE001
            log.warning("[%d/%d] %s veri hatasi: %s", i, len(symbols), sym, exc)
            continue
        if df.empty or len(df) < 100:
            log.warning("[%d/%d] %s yetersiz veri", i, len(symbols), sym)
            continue
        if first_df is None:
            first_df = df
        if args.no_regime:
            mask = pd.Series(True, index=df.index)
        else:
            if regime_mask_cache is None:
                regime_mask_cache = fetch_btc_regime_mask(ex, df.index, args.days)
            mask = regime_mask_cache.reindex(df.index.union(regime_mask_cache.index)).ffill().reindex(df.index)
            mask = mask.fillna(True).astype(bool)
            regime_mask_cache = regime_mask_cache.combine_first(mask)

        sig = build_signals_v2(df, mask) if args.engine == "v2" else build_signals_v1(df, mask)
        th = args.entry if args.entry is not None else (STRONG_TH if args.engine == "v2" else 2.0)
        res = backtest_one(df, sig, entry_th=th, exit_th=args.exit, max_hold=args.max_hold,
                           fee_bps=args.fee_bps, regime_exit=not args.no_regime)
        stats = perf_stats(res["bar_returns"], res["trades"])
        all_returns[sym] = res["bar_returns"]
        for t in res["trades"]:
            t["symbol"] = sym
        all_trades.extend(res["trades"])
        per_coin.append({"symbol": sym, **stats})
        log.info("[%d/%d] %-18s trades=%3d hit=%5.1f%% ret=%7.2f%% sharpe=%5.2f",
                 i, len(symbols), sym, stats.get("trades", 0), stats.get("hit_rate_pct", 0),
                 stats.get("total_return_pct", 0), stats.get("sharpe", 0))

    if not all_returns:
        log.error("Hic sonuc yok")
        return 1

    panel = pd.DataFrame(all_returns).fillna(0.0)
    port = panel.mean(axis=1)  # esit agirlikli portfoy
    stats = perf_stats(port, all_trades)

    BACKTEST_DIR.mkdir(exist_ok=True)
    stamp = now_utc().strftime("%Y%m%d_%H%M")
    pd.DataFrame(per_coin).to_csv(BACKTEST_DIR / f"per_coin_{args.engine}_{stamp}.csv", index=False)
    pd.DataFrame(all_trades).to_csv(BACKTEST_DIR / f"trades_{args.engine}_{stamp}.csv", index=False)
    (1 + port).cumprod().rename("equity").to_csv(BACKTEST_DIR / f"equity_{args.engine}_{stamp}.csv")

    by_side = pd.DataFrame(all_trades)
    print("\n" + "=" * 64)
    print(f" BACKTEST SONUCU  engine={args.engine}  tf={args.timeframe}  {args.days}g  {len(all_returns)} coin")
    print("=" * 64)
    print(f" Portfoy toplam getiri : {stats['total_return_pct']:8.2f} %")
    print(f" Sharpe (gunluk, yil.) : {stats['sharpe']:8.2f}")
    print(f" Max drawdown          : {stats['max_dd_pct']:8.2f} %")
    print(f" Islem sayisi          : {stats['trades']:8d}")
    print(f" Isabet orani          : {stats['hit_rate_pct']:8.1f} %")
    print(f" Ort. islem getirisi   : {stats['avg_trade_pct']:8.3f} %")
    if not by_side.empty:
        for side, g in by_side.groupby("side"):
            print(f"   {side:5s}: {len(g):5d} islem, isabet {(g['net_ret'] > 0).mean() * 100:5.1f}%, "
                  f"ort {g['net_ret'].mean() * 100:+.3f}%")
        print(" Cikis nedenleri: " + ", ".join(f"{k}={v}" for k, v in by_side["reason"].value_counts().items()))
    print(f" Sonuclar: {BACKTEST_DIR}")
    print("=" * 64)
    if stats["sharpe"] < 0.5:
        print(" UYARI: Sharpe dusuk/negatif. Sinyalleri otomatik emir icin KULLANMAYIN.")
    return 0


def cmd_scan(args: argparse.Namespace) -> int:
    data = run_scan(limit=args.limit, timeframe=args.timeframe)
    reg = data["regime"]
    print(f"\nBTC {reg['price']:,.0f}  rejim: {reg['regime']}  ({data['scanned']} sembol, {data['elapsed_s']:.0f} sn)\n")
    for title, key, rows in [
        ("GUCLU LONG", "net", data["strong_long"]),
        ("GUCLU SHORT", "net", data["strong_short"]),
        ("HAM LONG", "raw_net", data["raw_long"]),
        ("HAM SHORT", "raw_net", data["raw_short"]),
    ]:
        print(f"--- {title} ---")
        if not rows:
            print("  (yok)")
        for r in rows:
            print(f"  {r['base']:<10} {key}={r[key]:+4.1f}  px={_price(r['close']):>12}  "
                  f"RSI={r['rsi']:5.1f}  {', '.join(r['reasons'])}")
    print("--- FUNDING HARVEST ---")
    for h in data["harvest"]:
        print(f"  {h['base']:<10} simdi {h['funding_ann_now']:6.1f}%/y  30g {h['hist_ann_mean']:6.1f}%/y  "
              f"poz %{h['hist_pos_pct']:3.0f}  stab {h['hist_stability']:.2f}")
    return 0


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Binance USDT-M perpetual sinyal tarayici (karar destek, emir VERMEZ)",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("--mode", choices=["backtest", "scan", "dashboard", "serve"], default="dashboard")
    p.add_argument("--engine", choices=["v1", "v2"], default="v2", help="backtest sinyal motoru")
    p.add_argument("--limit", type=int, default=100, help="top N likit perpetual")
    p.add_argument("--timeframe", default=DEFAULT_TIMEFRAME, choices=list(TF_HOURS.keys()))
    p.add_argument("--days", type=int, default=365, help="backtest gun sayisi")
    p.add_argument("--symbols", default="", help="virgulle ayrilmis semboller (orn BTC,ETH,SOL)")
    p.add_argument("--entry", type=float, default=None, help="giris esigi |net| (v2 varsayilan 3)")
    p.add_argument("--exit", type=float, default=1.0, help="ters sinyal cikis esigi")
    p.add_argument("--max-hold", type=int, default=30, help="maks. bar tutma suresi")
    p.add_argument("--fee-bps", type=float, default=5.0, help="tek yon komisyon (bps)")
    p.add_argument("--no-regime", action="store_true", help="BTC rejim filtresini kapat")
    p.add_argument("--port", type=int, default=DEFAULT_PORT)
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--no-notify", action="store_true")
    p.add_argument("--log-file", default=None, help="log dosyasi (serve modunda varsayilan server.log)")
    p.add_argument("-v", "--verbose", action="store_true")
    return p


def cli() -> int:
    args = build_arg_parser().parse_args()
    log_file = args.log_file or ("server.log" if args.mode == "serve" else None)
    setup_logging(args.verbose, log_file)
    os.chdir(BASE_DIR)
    if args.mode == "backtest":
        return main(args)
    if args.mode == "scan":
        return cmd_scan(args)
    if args.mode == "dashboard":
        run_dashboard(limit=args.limit, timeframe=args.timeframe, notify=not args.no_notify)
        return 0
    if args.mode == "serve":
        serve_dashboard(port=args.port, limit=args.limit, timeframe=args.timeframe, host=args.host)
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(cli())
