# Сервис фотограмметрии (сборка модели предмета из фотографий) — портал, ветка scan.
# Оформлен так же, как соседние слоты (launch_slot3.ps1): скрытый процесс из планировщика,
# лог в файл рядом.
#
# GPU 0 закреплён намеренно: ComfyUI сидит на 2, языковые модели заняли 1 и 2. COLMAP на
# плотном этапе съедает всю видеопамять, и делить карту с генерацией — значит ронять обе.
$env:CUDA_VISIBLE_DEVICES = "0"
Set-Location "C:\photogrammetry"
& "C:\photogrammetry\venv\Scripts\python.exe" -m uvicorn scanserver:app --host 0.0.0.0 --port 8190 *> C:\photogrammetry\scan.log
