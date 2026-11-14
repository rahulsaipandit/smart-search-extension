"""S2 stage 3: requantise both CLIP towers (MatMul-only, per-channel int8), then re-run the full retrieval comparison.
Usage: python s2_q8.py <photos_dir> <models_dir> <out_dir>
"""
import sys, os, json
import numpy as np
import onnxruntime as ort
from onnxruntime.quantization import quantize_dynamic, QuantType
from PIL import Image, ImageOps
from tokenizers import Tokenizer

photos, models, out = sys.argv[1:4]
for src, dst in [("clip_b32_vision_fp32.onnx", "clip_b32_vision_q8mm.onnx"), ("clip_b32_text_fp32.onnx", "clip_b32_text_q8mm.onnx")]:
    d = os.path.join(models, dst)
    if not os.path.exists(d):
        quantize_dynamic(os.path.join(models, src), d, weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul"], per_channel=True)
    print(dst, round(os.path.getsize(d) / 1e6, 1), "MB", flush=True)

E = np.load(os.path.join(out, "embeds.npz"), allow_pickle=True)
paths, f32 = E["paths"], E["img_fp32"]
MEAN = np.array([0.48145466, 0.4578275, 0.40821073], np.float32); STD = np.array([0.26862954, 0.26130258, 0.27577711], np.float32)


def prep(p):
    im = Image.open(os.path.join(photos, p)); im.draft("RGB", (448, 448))
    im = ImageOps.exif_transpose(im).convert("RGB")
    s = 224 / min(im.size); im = im.resize((max(224, round(im.width * s)), max(224, round(im.height * s))), Image.BICUBIC)
    l, t = (im.width - 224) // 2, (im.height - 224) // 2
    return ((np.asarray(im.crop((l, t, l + 224, t + 224)), np.float32) / 255 - MEAN) / STD).transpose(2, 0, 1)


vs = ort.InferenceSession(os.path.join(models, "clip_b32_vision_q8mm.onnx"), providers=["CPUExecutionProvider"])
vecs = []
for j in range(0, len(paths), 16):
    X = np.stack([prep(p) for p in paths[j:j + 16]])
    v = vs.run(None, {"pixel_values": X})[0]; vecs.append(v / np.linalg.norm(v, axis=1, keepdims=True))
    if j % 320 == 0: print(j, flush=True)
q8 = np.concatenate(vecs)
np.save(os.path.join(out, "img_q8mm.npy"), q8)
cos = (q8 * f32).sum(1)

QUERIES = ["seaside", "ocean", "beach", "sunset", "birthday cake", "snow", "mountains", "forest", "flowers", "dog", "cat", "food",
           "restaurant", "temple", "fireworks", "kids playing", "wedding", "city at night", "car", "airport", "group photo", "selfie",
           "street", "boat", "lake", "garden", "festival", "baby", "bicycle", "river", "waterfall", "park", "airplane window",
           "christmas tree", "swimming pool", "hotel room", "road trip", "a person smiling", "building", "sky"]
tok = Tokenizer.from_file(os.path.join(models, "clip_tokenizer.json")); tok.no_padding(); tok.no_truncation()
ts = {k: ort.InferenceSession(os.path.join(models, f), providers=["CPUExecutionProvider"])
      for k, f in [("fp32", "clip_b32_text_fp32.onnx"), ("q8mm", "clip_b32_text_q8mm.onnx")]}


def et(k, q):
    v = ts[k].run(None, {"input_ids": np.array([tok.encode("a photo of " + q).ids[:77]], np.int64)})[0][0]; return v / np.linalg.norm(v)


T = {k: np.stack([et(k, q) for q in QUERIES]) for k in ts}


def ov(ci, ct, k=10):
    r = []
    for qi in range(len(QUERIES)):
        a = np.argsort(-(f32 @ T["fp32"][qi]))[:k]; b = np.argsort(-(ci @ ct[qi]))[:k]; r.append(len(set(a) & set(b)) / k)
    return float(np.mean(r)), r


tc = (T["fp32"] * T["q8mm"]).sum(1)
a, per = ov(q8, T["q8mm"]); b, _ = ov(f32, T["q8mm"]); c, _ = ov(q8, T["fp32"])
res = {"img_cos_q8mm_vs_fp32": {"mean": float(cos.mean()), "min": float(cos.min()), "p05": float(np.percentile(cos, 5))},
       "text_cos_q8mm_vs_fp32": {"mean": float(tc.mean()), "min": float(tc.min())},
       "overlap@10 q8mm x q8mm (all on tablet)": a, "overlap@10 q8mm text x fp32 img (desktop fp32 index)": b,
       "overlap@10 fp32 text x q8mm img": c, "worst_queries": sorted(zip(QUERIES, per), key=lambda x: x[1])[:5]}
json.dump(res, open(os.path.join(out, "q8mm.json"), "w"), indent=1)
print(json.dumps(res, indent=1))
