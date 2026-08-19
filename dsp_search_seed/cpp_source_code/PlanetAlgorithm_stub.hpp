#pragma once

// The browser build uses the same CPU planet algorithm as the native CApi.
// Keep this compatibility header so the existing WASM translation units can
// share the implementation without pulling in the GPU-specific entry point.
#include "PlanetAlgorithm.hpp"
