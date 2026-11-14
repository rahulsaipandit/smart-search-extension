"""Generate the two synthetic benchmark models used by the S0 probe app.

Run: python make_models.py <out_dir>   (needs `pip install onnx numpy`)

* bench_conv.onnx   - 4 strided 3x3 convs on 1x3x224x224 (~0.4 GFLOP): a rough stand-in for a
                      mobile vision encoder, to time per-image latency on the tablet CPU.
* bench_matmul.onnx - 8 chained 512x512 MatMuls on 64x512 (~0.27 GFLOP): a stand-in for a
                      small text encoder.
Weights are random; these models only measure speed and memory, never quality.
"""
import sys, os
import numpy as np
import onnx
from onnx import helper, TensorProto, numpy_helper

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
rng = np.random.default_rng(0)

def save(graph, name):
    m = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)])
    m.ir_version = 8
    onnx.checker.check_model(m)
    onnx.save(m, os.path.join(out, name))

# conv model
nodes, inits, prev, cin = [], [], "X", 3
for i, cout in enumerate([32, 64, 128, 256]):
    w = (rng.standard_normal((cout, cin, 3, 3)) * 0.05).astype(np.float32)
    inits.append(numpy_helper.from_array(w, f"w{i}"))
    nodes.append(helper.make_node("Conv", [prev, f"w{i}"], [f"c{i}"], strides=[2, 2], pads=[1, 1, 1, 1], kernel_shape=[3, 3]))
    nodes.append(helper.make_node("Relu", [f"c{i}"], [f"r{i}"]))
    prev, cin = f"r{i}", cout
nodes.append(helper.make_node("GlobalAveragePool", [prev], ["gap"]))
nodes.append(helper.make_node("Flatten", ["gap"], ["flat"], axis=1))
wf = (rng.standard_normal((256, 512)) * 0.05).astype(np.float32)
inits.append(numpy_helper.from_array(wf, "wf"))
nodes.append(helper.make_node("MatMul", ["flat", "wf"], ["Y"]))
g = helper.make_graph(nodes, "bench_conv", [helper.make_tensor_value_info("X", TensorProto.FLOAT, [1, 3, 224, 224])],
                      [helper.make_tensor_value_info("Y", TensorProto.FLOAT, [1, 512])], inits)
save(g, "bench_conv.onnx")

# matmul model
nodes, inits, prev = [], [], "X"
for i in range(8):
    w = (rng.standard_normal((512, 512)) * 0.04).astype(np.float32)
    inits.append(numpy_helper.from_array(w, f"m{i}"))
    out_name = "Y" if i == 7 else f"h{i}"
    nodes.append(helper.make_node("MatMul", [prev, f"m{i}"], [out_name]))
    prev = out_name
g = helper.make_graph(nodes, "bench_matmul", [helper.make_tensor_value_info("X", TensorProto.FLOAT, [64, 512])],
                      [helper.make_tensor_value_info("Y", TensorProto.FLOAT, [64, 512])], inits)
save(g, "bench_matmul.onnx")
print("ok")
