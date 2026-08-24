"""Bounded-клиент HYPERPC слота 4 (эмбеддинг + реранкер), MF-1998.

Контракт эндпоинтов зафиксирован админом машины в
`docs/process/hyperpc.local.llm.md` § «Слот 4»:

    POST /embed  {"inputs": [...], "prompt": "опц."} -> {"embeddings": [[...]], "dim": 2048}
    POST /rerank {"query": "...", "documents": [...], "top_k": N}
                 -> {"results": [{"index", "score"}, ...]}
    GET  /health -> {"status": "ok", "device": "cuda"}

`inputs`/`documents` принимают три формы — текст, URL картинки или
`{"text": "...", "image": "..."}` (мультимодальное единое пространство,
30+ языков, RU проверен). `Item` ниже — типизация этих трёх форм.

**Bounded = URL только из server env** (MF-1996 канон продукта: «browser
никогда не знает Tailscale IP HYPERPC») — `config.load_hyperpc_config()`
единственный источник `base_url`, сюда он приходит уже собранным, клиент
сам ничего не читает из os.environ и не принимает URL с фронта/из
пользовательского ввода.

Ретраи — только на сетевые сбои и 5xx/429 (временные), не на 4xx
(баг вызывающего кода, повтор не поможет) — тот же принцип, что
`gigachat_client.py` (GIGACHAT_RETRY_STATUS_CODES). После исчерпания
ретраев поднимается `HyperpcTimeout`/`HyperpcError` — единственная
обязанность вызывающего слоя (rank.py) — поймать её и деградировать
до lexical-only результата, не 500 (MF-1998 «Готово когда»).
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import httpx

from .config import HyperpcConfig

Item = str | dict

_RETRYABLE_STATUS_CODES = (429, 500, 502, 503, 504)


class HyperpcError(Exception):
    """Провайдер ответил ошибкой, которую повтор не лечит (4xx кроме 429)."""


class HyperpcTimeout(HyperpcError):
    """Сеть/таймаут/5xx — исчерпаны все ретраи. Вызывающий код должен деградировать."""


@dataclass(frozen=True)
class RerankResult:
    index: int
    score: float


class HyperpcClient:
    """Один HTTP-клиент на процесс воркера — переиспользует соединение."""

    def __init__(self, config: HyperpcConfig):
        self._config = config
        self._http = httpx.Client(base_url=config.base_url, timeout=config.timeout_seconds)

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> HyperpcClient:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    def health(self) -> bool:
        """`True`, если слот живой. Не ретраит и не бросает — чистая проверка."""
        try:
            response = self._http.get("/health")
            return response.status_code == 200 and response.json().get("status") == "ok"
        except httpx.HTTPError:
            return False

    def embed(self, inputs: list[Item], *, prompt: str | None = None) -> list[list[float]]:
        """Эмбеддинги в порядке `inputs`. Пустой список -> пустой список без вызова."""
        if not inputs:
            return []
        payload: dict = {"inputs": inputs}
        if prompt is not None:
            payload["prompt"] = prompt
        data = self._post("/embed", payload)
        embeddings = data.get("embeddings")
        if not isinstance(embeddings, list) or len(embeddings) != len(inputs):
            got = len(embeddings) if isinstance(embeddings, list) else "не список"
            raise HyperpcError(f"HYPERPC /embed вернул {got} векторов на {len(inputs)} входов")
        return embeddings

    def rerank(
        self, query: str, documents: list[Item], *, top_k: int | None = None
    ) -> list[RerankResult]:
        """Результаты, отсортированные провайдером по убыванию `score`.

        Пустой `documents` -> пустой список без вызова (симметрично `embed`)."""
        if not documents:
            return []
        payload: dict = {"query": query, "documents": documents}
        if top_k is not None:
            payload["top_k"] = top_k
        data = self._post("/rerank", payload)
        results = data.get("results")
        if not isinstance(results, list):
            raise HyperpcError("HYPERPC /rerank вернул ответ без 'results'")
        return [RerankResult(index=item["index"], score=item["score"]) for item in results]

    def _post(self, path: str, payload: dict) -> dict:
        attempt = 0
        while True:
            try:
                response = self._http.post(path, json=payload)
            except httpx.TimeoutException as exc:
                if attempt >= self._config.max_retries:
                    raise HyperpcTimeout(
                        f"HYPERPC {path}: таймаут после {attempt + 1} попыток"
                    ) from exc
                self._sleep_backoff(attempt)
                attempt += 1
                continue
            except httpx.HTTPError as exc:
                if attempt >= self._config.max_retries:
                    raise HyperpcTimeout(f"HYPERPC {path}: сеть недоступна: {exc}") from exc
                self._sleep_backoff(attempt)
                attempt += 1
                continue

            if response.status_code == 200:
                return response.json()

            retryable = response.status_code in _RETRYABLE_STATUS_CODES
            if retryable and attempt < self._config.max_retries:
                self._sleep_backoff(attempt)
                attempt += 1
                continue

            if retryable:
                raise HyperpcTimeout(
                    f"HYPERPC {path}: статус {response.status_code} после {attempt + 1} попыток"
                )
            raise HyperpcError(
                f"HYPERPC {path}: статус {response.status_code}: {response.text[:200]!r}"
            )

    def _sleep_backoff(self, attempt: int) -> None:
        time.sleep(self._config.retry_backoff_seconds * (2**attempt))
