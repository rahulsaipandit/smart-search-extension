# S2: CLIP retrieval quality and quantisation (local scripts)

Run in order with `python <script> <photos_dir> <models_dir> <out_dir>` (`s2_report.py` takes `<models_dir> <out_dir>`):
`s2_embed.py` (fp32 + public int8 image vectors) -> `s2_report.py` -> `s2_extra.py` (text drift, requantisation test)
-> `s2_q8.py` (MatMul-only per-channel int8 for both towers, full comparison) -> `s2_sheet2.py` (HTML contact sheet).
Needs `pip install onnxruntime pillow tokenizers numpy` and the Xenova/clip-vit-base-patch32 ONNX files + tokenizer.
Outputs contain thumbnails of the photos: write them outside the repo and never publish them.
