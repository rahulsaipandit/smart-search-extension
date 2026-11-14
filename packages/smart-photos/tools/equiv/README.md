# Tablet-vs-desktop equivalence test (CLIP image tower)

1. Build/install the debug `frame` app, push a few photos, write their relative paths (one per line) to
   `<app files>/equiv/list.txt`, then `adb shell am start -n com.smartphotos.frame/.MainActivity --ez equiv true`.
2. `adb pull <app files>/equiv/` and run `equiv_tensors.py` - the preprocessed tensors must be bit-identical to Pillow's, and the embedding cosine
   should be ~0.99 (the rest is int8 numerics of ONNX Runtime on ARM vs x86).
3. After a full index: `adb exec-out run-as com.smartphotos.frame cat files/index.bin > index.bin`, then `index_cosine.py`.

Needs `pip install numpy pillow onnxruntime`. Outputs reference personal photos: keep them out of the repo.
