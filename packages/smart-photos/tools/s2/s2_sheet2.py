"""S2 stage 4: contact sheet for human relevance judgement, comparing realistic configs.
Usage: python s2_sheet2.py <models_dir> <out_dir>
Rows per query: A = fp32 text x fp32 image (ceiling), B = fp32 text x q8mm image (tablet-indexed, fp32 text tower),
C = q8mm text x q8mm image (everything quantised). A photo ticked in one row counts in every row it appears in.
Local only: the HTML embeds thumbnails of the user's photos.
"""
import sys, os, json, base64, html
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

models, out = sys.argv[1:3]
E = np.load(os.path.join(out, "embeds.npz"), allow_pickle=True)
T = np.load(os.path.join(out, "thumbs.npz"), allow_pickle=True)["thumbs"]
f32, q8 = E["img_fp32"], np.load(os.path.join(out, "img_q8mm.npy"))
QUERIES = ["seaside", "ocean", "beach", "sunset", "birthday cake", "snow", "mountains", "forest", "flowers", "dog", "cat", "food",
           "restaurant", "temple", "fireworks", "kids playing", "wedding", "city at night", "group photo", "selfie",
           "boat", "lake", "garden", "baby", "waterfall", "christmas tree", "swimming pool", "a person smiling"]
tok = Tokenizer.from_file(os.path.join(models, "clip_tokenizer.json")); tok.no_padding(); tok.no_truncation()
ts = {k: ort.InferenceSession(os.path.join(models, f), providers=["CPUExecutionProvider"])
      for k, f in [("fp32", "clip_b32_text_fp32.onnx"), ("q8mm", "clip_b32_text_q8mm.onnx")]}


def et(k, q):
    v = ts[k].run(None, {"input_ids": np.array([tok.encode("a photo of " + q).ids[:77]], np.int64)})[0][0]; return v / np.linalg.norm(v)


K = 8
CFG = {"A": ("fp32", f32), "B": ("fp32", q8), "C": ("q8mm", q8)}
tops = {c: [np.argsort(-(m @ et(t, q)))[:K] for q in QUERIES] for c, (t, m) in CFG.items()}
b64 = lambda i: "data:image/jpeg;base64," + base64.b64encode(T[i]).decode()
LABEL = {"A": "A  fp32 text + fp32 image (ceiling)", "B": "B  fp32 text + int8-matmul image", "C": "C  int8-matmul text + int8-matmul image"}
parts = ["""<!doctype html><meta charset=utf-8><title>S2 contact sheet (local only)</title>
<style>body{font:14px system-ui;margin:16px;background:#111;color:#eee}h2{margin:20px 0 2px}h3{margin:6px 0 2px;font-size:12px;color:#9ab}
.row{display:flex;gap:6px;flex-wrap:wrap}.c{position:relative}.c img{height:100px;display:block;border-radius:4px}
.c label{position:absolute;left:3px;top:3px;background:#000b;padding:1px 4px;border-radius:3px;font-size:12px}
button{padding:6px 12px;margin:8px 0}#sum{white-space:pre;font-family:monospace}</style>
<h1>S2: does CLIP ViT-B/32 find your photos?</h1>
<p>For each query, tick every photo that <b>clearly matches</b>. A photo that appears in several rows is one checkbox
(ticking it anywhere ticks it everywhere). Queries with nothing relevant in your album should simply stay unticked.
When done press the button; it shows precision@8 per configuration. <b>This page embeds thumbnails of your photos. Keep it local.</b></p>
<button onclick="calc()">Compute precision@8</button><div id=sum></div>"""]
for qi, q in enumerate(QUERIES):
    parts.append(f"<h2>{html.escape(q)}</h2>")
    for c in "ABC":
        parts.append(f"<h3>{LABEL[c]}</h3><div class=row>")
        for r, i in enumerate(tops[c][qi]):
            parts.append(f"<div class=c><img src='{b64(i)}'><label><input type=checkbox data-q='{qi}' data-i='{i}'> {r+1}</label></div>")
        parts.append("</div>")
parts.append("""<script>
const Q=%s, TOP=%s, K=%d;
document.addEventListener('change',e=>{const t=e.target;if(t.dataset&&t.dataset.i)document.querySelectorAll('input[data-q="'+t.dataset.q+'"][data-i="'+t.dataset.i+'"]').forEach(x=>x.checked=t.checked)});
function calc(){const tot={A:0,B:0,C:0};let s='query'.padEnd(20)+'A  B  C   (hits of 8)\\n';
Q.forEach((q,qi)=>{const h={};for(const c of 'ABC'){const ids=TOP[c][qi];h[c]=ids.filter(i=>{const b=document.querySelector('input[data-q="'+qi+'"][data-i="'+i+'"]');return b&&b.checked}).length;tot[c]+=h[c]}
s+=q.padEnd(20)+h.A+'  '+h.B+'  '+h.C+'\\n'});
s+='\\nprecision@8:  A='+(tot.A/(K*Q.length)).toFixed(3)+'  B='+(tot.B/(K*Q.length)).toFixed(3)+'  C='+(tot.C/(K*Q.length)).toFixed(3);
document.getElementById('sum').textContent=s}
</script>""" % (json.dumps(QUERIES), json.dumps({c: [t.tolist() for t in v] for c, v in tops.items()}), K))
open(os.path.join(out, "contact_sheet2.html"), "w", encoding="utf-8").write("".join(parts))
print("overlap A vs B top8:", np.mean([len(set(a) & set(b)) / K for a, b in zip(tops["A"], tops["B"])]),
      " A vs C:", np.mean([len(set(a) & set(b)) / K for a, b in zip(tops["A"], tops["C"])]))
