"""S2 stage 1: embed a photo folder with CLIP ViT-B/32 fp32 and int8, entirely locally.

Usage: python s2_embed.py <photos_dir> <models_dir> <out_dir>
Writes out_dir/embeds.npz (paths, img_fp32, img_int8) and out_dir/thumbs.npz (192 px JPEG bytes).
Nothing is uploaded; the photos are only read. Preprocessing matches the Xenova preprocessor_config:
resize shortest edge to 224 (bicubic), centre crop 224, rescale 1/255, normalise with CLIP mean/std.
"""
import sys, os, io, time
import numpy as np
from PIL import Image, ImageOps
import onnxruntime as ort

photos, models, out = sys.argv[1:4]
os.makedirs(out, exist_ok=True)
MEAN = np.array([0.48145466, 0.4578275, 0.40821073], np.float32)
STD = np.array([0.26862954, 0.26130258, 0.27577711], np.float32)

paths = sorted(os.path.join(dp, f) for dp, _, fs in os.walk(photos) for f in fs if f.lower().endswith((".jpg", ".jpeg")))
print("images:", len(paths), flush=True)


def load(path):
    im = Image.open(path)
    im.draft("RGB", (448, 448))  # fast JPEG downscale on decode
    im = ImageOps.exif_transpose(im).convert("RGB")
    thumb = im.copy()
    thumb.thumbnail((192, 192))
    b = io.BytesIO(); thumb.save(b, "JPEG", quality=70)
    w, h = im.size
    s = 224 / min(w, h)
    im = im.resize((max(224, round(w * s)), max(224, round(h * s))), Image.BICUBIC)
    w, h = im.size
    l, t = (w - 224) // 2, (h - 224) // 2
    im = im.crop((l, t, l + 224, t + 224))
    arr = (np.asarray(im, np.float32) / 255.0 - MEAN) / STD
    return arr.transpose(2, 0, 1), b.getvalue()


opts = ort.SessionOptions()
sessions = {k: ort.InferenceSession(os.path.join(models, f), opts, providers=["CPUExecutionProvider"])
            for k, f in [("fp32", "clip_b32_vision_fp32.onnx"), ("int8", "clip_b32_vision_int8.onnx")]}
vecs = {k: [] for k in sessions}
thumbs = []
ok_paths = []
batch, bpaths = [], []
t0 = time.time()


def flush():
    global batch, bpaths
    if not batch:
        return
    x = np.stack(batch)
    for k, s in sessions.items():
        v = s.run(None, {"pixel_values": x})[0]
        vecs[k].append(v / np.linalg.norm(v, axis=1, keepdims=True))
    ok_paths.extend(bpaths)
    batch, bpaths = [], []


for i, p in enumerate(paths):
    try:
        a, th = load(p)
    except Exception as e:  # unreadable file: record and continue
        print("SKIP", os.path.relpath(p, photos), e, flush=True)
        continue
    batch.append(a); bpaths.append(p); thumbs.append(th)
    if len(batch) == 16:
        flush()
    if (i + 1) % 80 == 0:
        print(f"{i+1}/{len(paths)}  {time.time()-t0:.0f}s", flush=True)
flush()
rel = np.array([os.path.relpath(p, photos).replace("\\", "/") for p in ok_paths])
np.savez(os.path.join(out, "embeds.npz"), paths=rel, **{f"img_{k}": np.concatenate(v) for k, v in vecs.items()})
np.savez(os.path.join(out, "thumbs.npz"), thumbs=np.array(thumbs, dtype=object), allow_pickle=True)
print("done", len(ok_paths), f"{time.time()-t0:.0f}s", flush=True)
