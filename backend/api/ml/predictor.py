import numpy as np
from datetime import date


def _biz_day_of_month(d: date) -> int:
    """Nth business day of the month (no holiday calendar — simplified)."""
    count = 0
    for day in range(1, d.day + 1):
        if date(d.year, d.month, day).weekday() < 5:
            count += 1
    return count


def _calendar_features(d) -> list:
    if isinstance(d, str):
        d = date.fromisoformat(d[:10])
    bday = _biz_day_of_month(d)
    return [
        d.weekday(),                          # 0=Mon … 6=Sun
        d.day,                                # 1-31
        d.month,                              # 1-12
        int(d.weekday() == 0),               # is_monday
        int(d.weekday() == 4),               # is_friday
        int(bday == 5),                       # is_5th_business_day
        int(bday >= 18),                      # near month-end (~last 3 biz days)
        int(d.day <= 3),                      # is_month_start
        int(d.weekday() == 0 and d.day <= 7), # first monday (weekend accumulation)
    ]


class DurationPredictor:
    """Statistical + ML duration predictor with graceful fallback.

    Fit strategy:
      - n < 10  : returns mean (no percentile split with tiny data)
      - 10 ≤ n < 30: percentile-based lookup
      - n ≥ 30  : Ridge regression with calendar features + residual offsets
    """

    def __init__(self):
        self._model = None
        self._p50 = self._p75 = self._p90 = self._p95 = 0.0
        self._mean = 0.0
        self._res_p75 = self._res_p90 = 0.0
        self._n = 0

    def fit(self, dados: list) -> 'DurationPredictor':
        durs = [float(d['duracao']) for d in dados
                if d.get('duracao') and float(d['duracao']) > 0]
        if not durs:
            return self

        arr = np.array(durs)
        self._n = len(arr)
        self._mean = float(arr.mean())
        self._p50  = float(np.percentile(arr, 50))
        self._p75  = float(np.percentile(arr, 75))
        self._p90  = float(np.percentile(arr, 90))
        self._p95  = float(np.percentile(arr, 95))

        if self._n >= 30:
            try:
                self._fit_model(dados)
            except Exception:
                pass

        return self

    def _fit_model(self, dados):
        from sklearn.linear_model import Ridge
        from sklearn.preprocessing import StandardScaler
        from sklearn.pipeline import Pipeline

        pairs = [(d['data'], float(d['duracao']))
                 for d in dados if d.get('duracao') and float(d['duracao']) > 0]
        X = np.array([_calendar_features(p[0]) for p in pairs])
        y = np.array([p[1] for p in pairs])

        pipe = Pipeline([('sc', StandardScaler()), ('reg', Ridge(alpha=1.0))])
        pipe.fit(X, y)

        resid = y - pipe.predict(X)
        self._model = pipe
        self._res_p75 = float(np.percentile(resid, 75))
        self._res_p90 = float(np.percentile(resid, 90))

    def predict(self, data_ref, percentil: int = 50) -> float:
        if self._n == 0:
            return 0.0

        p_map = {50: self._p50, 75: self._p75, 90: self._p90, 95: self._p95}
        fallback = p_map.get(percentil, self._mean)

        if self._model is None:
            return max(0.0, fallback)

        try:
            X = np.array([_calendar_features(data_ref)])
            base = float(max(0.0, self._model.predict(X)[0]))
            if percentil >= 90:
                return max(0.0, base + self._res_p90)
            if percentil >= 75:
                return max(0.0, base + self._res_p75)
            return max(0.0, base)
        except Exception:
            return max(0.0, fallback)

    @property
    def n_samples(self) -> int:
        return self._n

    @property
    def method(self) -> str:
        if self._n == 0:
            return 'sem_dados'
        if self._model is not None:
            return 'ml_ridge'
        if self._n >= 10:
            return 'percentil'
        return 'media'
