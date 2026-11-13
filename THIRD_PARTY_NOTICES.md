# Third-party notices

## EfficientSAM

Heavy Chain can load the EfficientSAM-Ti encoder and decoder for interactive
point-prompt segmentation.

- Project: EfficientSAM
- Copyright: YFormer contributors
- Source: https://github.com/yformer/EfficientSAM
- Pinned revision: `d525f622e6f640acf5a0fc37c7ca1f243da5bde0`
- License: Apache License 2.0

EfficientSAM is used under the Apache License 2.0. The license text is available
from the upstream source above and at https://www.apache.org/licenses/LICENSE-2.0.

## VTracer and vtracer-wasm

Heavy Chain traces raster images into vector SVG in the browser (SVGにする) with
VTracer, compiled to WebAssembly by vtracer-wasm.

- Project: VTracer (visioncortex)
- Copyright: (c) 2024 TSANG, Hao Fung
- Source: https://github.com/visioncortex/vtracer
- License: MIT License
- WebAssembly build: vtracer-wasm 0.1.0, Copyright (c) 2025 jsscheller,
  https://github.com/jsscheller/vtracer-wasm, MIT License

The MIT license texts are shipped with the npm package (`node_modules/vtracer-wasm/LICENSE`)
and available from the upstream sources above.

## Real-ESRGAN (realesr-animevideov3)

Heavy Chain enlarges AIグラフィックデザイン proposals 2× in the browser (2倍の大きさ) with the
Real-ESRGAN compact model `realesr-animevideov3`. The official v0.2.5.0 weights
(`realesr-animevideov3.pth`, sha256 `b8a8376811077954d82ca3fcf476f1ac3da3e8a68a4f4d71363008000a18b75d`)
were exported to ONNX with a 2×2 average added at the end, in full and half precision
(`public/assets/realesr-animevideov3-x2.onnx`, `public/assets/realesr-animevideov3-x2-fp16.onnx`).

- Project: Real-ESRGAN
- Copyright: (c) 2021, Xintao Wang
- Source: https://github.com/xinntao/Real-ESRGAN (release v0.2.5.0)
- License: BSD 3-Clause License

```
BSD 3-Clause License

Copyright (c) 2021, Xintao Wang
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
