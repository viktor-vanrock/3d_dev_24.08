"""Маски объекта отдельным процессом.

Отдельным — не для красоты: onnxruntime на этой машине уже показал нрав (DLL-падения), а
нативный крах внутри сервиса убивает и все задания разом. Здесь пусть падает — сервис
переживёт и просто соберёт без масок.

Вызов: maskgen.py <images_dir> <masks_dir>. Печатает медианную долю предмета в кадре.
"""
import statistics
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from rembg import new_session, remove

images = Path(sys.argv[1])
masks = Path(sys.argv[2])
masks.mkdir(exist_ok=True)

session = new_session("u2net")
fractions = []
for f in sorted(images.iterdir()):
    original = Image.open(f)
    small = original.convert("RGB")
    small.thumbnail((1024, 1024))
    mask = remove(small, session=session, only_mask=True)
    # Порог и расширение — на уменьшенной маске, растяжение последним: морфология на
    # 12-мегапиксельной картинке съедала минуты на кадр, на уменьшенной — мгновенна, а
    # после растяжения результат неотличим.
    mask = mask.point(lambda v: 255 if v > 127 else 0).filter(ImageFilter.MaxFilter(5))
    mask = mask.resize(original.size)
    fractions.append(float(np.asarray(mask).mean()) / 255.0)
    mask.save(masks / (f.name + ".png"))

print(f"share={statistics.median(fractions):.4f}")
