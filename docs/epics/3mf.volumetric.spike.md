# Volumetric/Implicit: time-boxed spike MF-380

Дата проверки: 13.07.2026. Решение: **NO-GO для baseline**, пересмотреть
13.01.2027 или раньше, если появится headless-потребитель с тестовым набором.

## Что проверено

В `apps/mesh` с `lib3mf==2.5.0` выполнено:

```sh
uv run python - <<'PY'
import lib3mf
print(".".join(map(str, lib3mf.Wrapper().GetLibraryVersion())))
print([name for name in dir(lib3mf.Model)
       if any(x in name.lower() for x in ("implicit", "volum", "image3d", "level"))])
PY
```

Фактический результат: библиотека загрузилась как `2.5.0`; Python binding
экспортирует `Model.AddImplicitFunction`, `Model.AddFunctionFromImage3D`,
`Model.AddLevelSet`, `Model.AddVolumeData`, `ImplicitFunction.Add*Node` и
`LevelSet.SetFunction`/`SetMesh`. То есть поверхность API для graph/level-set
в Python существует. Однако в binding нет высокоуровневого генератора TPMS,
автоматической тесселяции или готового fallback «implicit → mesh» одной
операцией; построение графа требует ручной сборки узлов/портов и отдельной
проверки записи/чтения.

## Потребитель и fallback

Официальный [Gladius](https://github.com/3MFConsortium/gladius) заявляет импорт
и экспорт 3MF с Volumetric Extension, редактирование function graph,
визуализацию и экспорт `stl`/контуров. Это подходящий исследовательский
потребитель, но не headless-слайсер: проект сам указывает раннюю стадию и
требует OpenCL/OpenGL. В текущем VDS бинарника Gladius нет; автоматического
прогона файла через него не проведено.

В качестве fallback Gladius умеет экспортировать STL, но это capability
редактора, а не воспроизводимый server-side путь `apps/mesh`. В репозитории
нет доказанного конвертера `levelset → mesh`, который можно безопасно включить
в очередь с лимитами памяти/времени.

Слайсеры PrusaSlicer/OrcaSlicer не являются проверенными потребителями
Volumetric в этом spike: в окружении есть только PrusaSlicer 2.7.2, OrcaSlicer
и Gladius отсутствуют. Поэтому нельзя объявлять implicit-файл пригодным для
печати или добавлять его в baseline без отдельного внешнего контура проверки.

## Обоснование решения

- **API:** наличие Python surface подтверждено, но минимальный graph PoC с
  записью/чтением и level-set fallback не собран в пределах spike.
- **Потребитель:** Gladius — единственный найденный официальный инструмент,
  но он GUI/исследовательский и не закрывает production slicing.
- **Fallback:** экспорт STL заявлен Gladius, однако server-side fallback в
  `apps/mesh` отсутствует и не тестируется.
- **Риск:** добавление volumetric-ресурсов в канонический 3MF сейчас может
  сделать файл невидимым для реальных слайсеров и нарушить основной контракт
  «валидный и печатаемый 3MF».

Следующий spike должен принести минимальный graph (например, signed-distance
сферу/TPMS), lib3mf round-trip, экспорт level-set в меш с ограничениями и
проверку хотя бы одним headless-потребителем. До этого Volumetric остаётся
отдельным экспериментом и не меняет `mesh.convert`.

Источники: [индекс спецификаций 3MF](https://3mf.io/spec/),
[документация lib3mf 2.5.0](https://lib3mf.readthedocs.io/en/master/),
[репозиторий Gladius](https://github.com/3MFConsortium/gladius).
