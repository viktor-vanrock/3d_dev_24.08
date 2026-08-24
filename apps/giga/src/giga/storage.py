"""S3-доступ (cloud.ru) для apps/giga: заливка артефактов генерации и фото диагностики.

Ключи генерации — `generations/{id}/artifact.{ext}` и
`generations/{id}/preview.{ext}` (нейтрально к ветке openscad/kzd/hueforge).
Ключи диагностики — `diagnostics/{id}/photo.{ext}` (MF-360). Path-style, тот
же паттерн, что `apps/mesh/src/mesh/storage.py` и `apps/api/src/storage/s3.ts`.

Бакет — параметр `ObjectStore`, не завязан на одно поле `S3Config`: `generations`
и `diagnostics` — разные бакеты одного S3-аккаунта (см. `config.S3Config`).
"""

from __future__ import annotations

import boto3

from .config import S3Config


class ObjectStore:
    """Тонкая обёртка над S3-клиентом для одного бакета."""

    def __init__(self, config: S3Config, bucket: str | None = None) -> None:
        self._bucket = bucket if bucket is not None else config.bucket_generations
        self._client = boto3.client(
            "s3",
            endpoint_url=config.endpoint,
            region_name=config.region,
            aws_access_key_id=config.access_key,
            aws_secret_access_key=config.secret_key,
        )

    def upload_bytes(self, key: str, body: bytes, content_type: str) -> None:
        """Заливает содержимое в память под ключ с указанным Content-Type."""
        self._client.put_object(Bucket=self._bucket, Key=key, Body=body, ContentType=content_type)

    def list_keys(self, prefix: str) -> list[str]:
        """Ключи под префиксом, по возрастанию. Нужен ветке `scan`: кадры съёмки заливает
        apps/api по одному, и сколько их доехало, знает только само хранилище."""
        keys: list[str] = []
        token: str | None = None
        while True:
            kwargs = {"Bucket": self._bucket, "Prefix": prefix}
            if token:
                kwargs["ContinuationToken"] = token
            page = self._client.list_objects_v2(**kwargs)
            keys.extend(item["Key"] for item in page.get("Contents", []))
            if not page.get("IsTruncated"):
                return sorted(keys)
            token = page.get("NextContinuationToken")

    def download_bytes(self, key: str) -> bytes:
        return self._client.get_object(Bucket=self._bucket, Key=key)["Body"].read()

    def delete_prefix(self, prefix: str) -> None:
        """Убирает всё под префиксом. Кадры съёмки нужны ровно на время сборки — держать
        сотню снимков предмета после того, как модель готова, незачем."""
        keys = self.list_keys(prefix)
        for start in range(0, len(keys), 1000):
            chunk = keys[start:start + 1000]
            if chunk:
                self._client.delete_objects(
                    Bucket=self._bucket, Delete={"Objects": [{"Key": k} for k in chunk]}
                )


def scan_photo_prefix(scan_id: str) -> str:
    """Куда apps/api складывает кадры съёмки до того, как появится генерация."""
    return f"scans/{scan_id}/"


def artifact_key(generation_id: str, ext: str) -> str:
    """Ключ основного артефакта генерации."""
    return f"generations/{generation_id}/artifact.{ext}"


def preview_key(generation_id: str, ext: str) -> str:
    """Ключ превью генерации (может отсутствовать — не у всех веток)."""
    return f"generations/{generation_id}/preview.{ext}"


def diagnostic_photo_key(photo_id: str, ext: str) -> str:
    """Ключ загруженного фото дефекта печати (MF-360)."""
    return f"diagnostics/{photo_id}/photo.{ext}"
