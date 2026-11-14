"""Equivalence test (tablet vs desktop), step 1: for photos listed in list.txt (paths relative to the app photos folder, e.g. 2025/2025_01_01/x.jpg),
compare the CLIP input tensor and embedding the tablet dumped (`--ez equiv true`, debug build) with the Pillow pipeline of s2_q8.py."""
import numpy as np, os
from PIL import Image, ImageOps
import onnxruntime as ort
import sys
# usage: python equiv_tensors.py <photos_dir(with trailing /)> <models_dir(with trailing /)> <list.txt> <pulled equiv dir(with trailing /)>
PH, SC, LIST, D = sys.argv[1:5]
MEAN=np.array([0.48145466,0.4578275,0.40821073],np.float32); STD=np.array([0.26862954,0.26130258,0.27577711],np.float32)
def prep(p):   # identical to s2_q8.py
    im=Image.open(PH+p); im.draft("RGB",(448,448))
    im=ImageOps.exif_transpose(im).convert("RGB")
    s=224/min(im.size); im=im.resize((max(224,round(im.width*s)),max(224,round(im.height*s))),Image.BICUBIC)
    l,t=(im.width-224)//2,(im.height-224)//2
    return ((np.asarray(im.crop((l,t,l+224,t+224)),np.float32)/255-MEAN)/STD).transpose(2,0,1)
vs=ort.InferenceSession(SC+"clip_b32_vision_q8mm.onnx",providers=["CPUExecutionProvider"])
rels=[l.strip() for l in open(LIST) if l.strip()]
print("idx  tensor: max|d|  mean|d|   pixels>1/255-ish   | embedding cosine device-vs-desktop")
cs=[]
for i,r in enumerate(rels):
    py=prep(r.split('/',1)[1])
    dev=np.fromfile(D+f"{i}.f32",dtype="<f4").reshape(3,224,224)
    dv=np.fromfile(D+f"{i}.vec",dtype="<f4")
    v=vs.run(None,{"pixel_values":py[None]})[0][0]; v/=np.linalg.norm(v)
    d=np.abs(py-dev); cs.append(float(dv@v))
    print(f"{i:2d}  {d.max():.4f}  {d.mean():.5f}  {np.mean(d>0.05):.4f}   | {dv@v:.5f}")
print("mean cosine", np.mean(cs), "min", np.min(cs))
