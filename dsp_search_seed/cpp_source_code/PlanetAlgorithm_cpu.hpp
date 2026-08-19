#pragma once

// The CPU-only WASM build shares the native algorithm definitions. GPU calls
// are disabled by wasm_opencl_stub.cpp.
#include "PlanetAlgorithm.hpp"
