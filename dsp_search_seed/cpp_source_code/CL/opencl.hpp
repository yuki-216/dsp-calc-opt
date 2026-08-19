// OpenCL stub for WebAssembly build
// WebAssembly doesn't support GPU compute, so this is a minimal stub
#pragma once

// Minimal stubs for OpenCL types used in PlanetAlgorithm.hpp
typedef int cl_int;
typedef unsigned int cl_uint;
typedef void* cl_platform_id;
typedef void* cl_device_id;
typedef void* cl_context;
typedef void* cl_command_queue;
typedef void* cl_program;
typedef void* cl_kernel;
typedef void* cl_mem;

#define CL_SUCCESS 0
#define CL_DEVICE_TYPE_GPU 2
#define CL_FALSE 0
#define CL_TRUE 1
#define CL_MEM_READ_ONLY 1
#define CL_MEM_WRITE_ONLY 2
#define CL_MEM_COPY_HOST_PTR 4

#include <cstddef>
#include <string>
#include <vector>

namespace cl {
class Kernel;
struct NullRangeType;
struct NDRange;
class Device {};
class Context {};
struct NullRangeType {};
struct NDRange {
    NDRange(std::size_t) {}
};
class Buffer {
public:
    Buffer() = default;
    Buffer(const Context&, int, std::size_t, void* = nullptr) {}
};
class Program {
public:
    using Sources = std::vector<std::string>;
    Program() = default;
    Program(const Context&, const Sources&) {}
    int build(const std::vector<Device>&) { return CL_SUCCESS; }
    template <typename T>
    std::string getBuildInfo(const Device&) const { return {}; }
};
class CommandQueue {
public:
    CommandQueue() = default;
    CommandQueue(const Context&, const Device&) {}
    int enqueueWriteBuffer(const Buffer&, int, std::size_t, std::size_t, const void*) { return CL_SUCCESS; }
    int enqueueReadBuffer(const Buffer&, int, std::size_t, std::size_t, void*) { return CL_SUCCESS; }
    int enqueueNDRangeKernel(const Kernel&, struct NullRangeType, struct NDRange, struct NDRange) { return CL_SUCCESS; }
};
class Kernel {
public:
    Kernel() = default;
    Kernel(const Program&, const char*) {}
    template <typename T>
    int setArg(int, const T&) { return CL_SUCCESS; }
};
inline constexpr NullRangeType NullRange{};
}

// Stub function declarations
inline cl_int clGetPlatformIDs(cl_uint, cl_platform_id*, cl_uint*) { return CL_SUCCESS; }
inline cl_int clGetDeviceIDs(cl_platform_id, cl_uint, cl_uint, cl_device_id*, cl_uint*) { return CL_SUCCESS; }
