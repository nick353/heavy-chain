# Rebuilds public/assets/realesr-animevideov3-x2{,-fp16}.onnx (「2倍の大きさ」, src/lib/superResolution.ts).
# Needs torch 2.2, onnx, onnxconverter-common (e.g. `uv venv && uv pip install torch==2.2.2 "numpy<2" onnx onnxconverter-common`).
# Usage: python scripts/build-realesrgan-onnx.py realesr-animevideov3.pth public/assets
#   realesr-animevideov3.pth: https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-animevideov3.pth
#   (sha256 b8a8376811077954d82ca3fcf476f1ac3da3e8a68a4f4d71363008000a18b75d, BSD-3-Clause)
import hashlib
import os
import sys

import onnx
import torch
import torch.nn as nn
import torch.nn.functional as F
from onnx import helper
from onnxconverter_common import float16


class SRVGGNetCompact(nn.Module):
    """Real-ESRGAN's compact network (basicsr SRVGGNetCompact): conv + PReLU × (num_conv + 1), pixel shuffle, + nearest."""

    def __init__(self, num_feat=64, num_conv=16, upscale=4):
        super().__init__()
        self.upscale = upscale
        body = [nn.Conv2d(3, num_feat, 3, 1, 1), nn.PReLU(num_parameters=num_feat)]
        for _ in range(num_conv):
            body += [nn.Conv2d(num_feat, num_feat, 3, 1, 1), nn.PReLU(num_parameters=num_feat)]
        body.append(nn.Conv2d(num_feat, 3 * upscale * upscale, 3, 1, 1))
        self.body = nn.ModuleList(body)
        self.upsampler = nn.PixelShuffle(upscale)

    def forward(self, x):
        out = x
        for layer in self.body:
            out = layer(out)
        return self.upsampler(out) + F.interpolate(x, scale_factor=self.upscale, mode='nearest')


weights, out_dir = sys.argv[1], sys.argv[2]
digest = hashlib.sha256(open(weights, 'rb').read()).hexdigest()
assert digest == 'b8a8376811077954d82ca3fcf476f1ac3da3e8a68a4f4d71363008000a18b75d', digest
state = torch.load(weights, map_location='cpu')
state = state.get('params_ema') or state.get('params') or state
model = SRVGGNetCompact()
model.load_state_dict(state, strict=True)
model.eval()
x4 = os.path.join(out_dir, 'realesr-animevideov3-x4.tmp.onnx')
torch.onnx.export(model, torch.rand(1, 3, 64, 64), x4, opset_version=17, input_names=['input'], output_names=['output'],
                  dynamic_axes={'input': {2: 'h', 3: 'w'}, 'output': {2: 'H', 3: 'W'}})
# 4× → 2×: a 2×2 average at the end of the graph (sharp edges, less grain, a quarter of the pixels read back).
graph = onnx.load(x4)
os.remove(x4)
for node in graph.graph.node:
    node.output[:] = ['output_x4' if name == 'output' else name for name in node.output]
graph.graph.node.append(helper.make_node('AveragePool', ['output_x4'], ['output'], kernel_shape=[2, 2], strides=[2, 2]))
onnx.checker.check_model(graph)
onnx.save(graph, os.path.join(out_dir, 'realesr-animevideov3-x2.onnx'))
onnx.save(float16.convert_float_to_float16(graph, keep_io_types=True), os.path.join(out_dir, 'realesr-animevideov3-x2-fp16.onnx'))
print('ok')
