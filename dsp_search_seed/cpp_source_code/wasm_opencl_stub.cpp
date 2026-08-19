#include "PlanetAlgorithm.hpp"

bool OpenCLManager::SUPPORT_GPU = false;
int OpenCLManager::local_size = 32;
int OpenCLManager::device_id = -1;
std::vector<cl::Device> OpenCLManager::devices;
std::vector<std::string> OpenCLManager::devices_info;
cl::Context OpenCLManager::context;
cl::Device OpenCLManager::device;
cl::Program OpenCLManager::program;
cl::Buffer OpenCLManager::vertices_buffer;
size_t OpenCLManager::cfg_version = 0;
std::mutex OpenCLManager::lock;
int OpenCLManager::max_worker = 4;
int OpenCLManager::cur_worker = 0;

Vector3 PlanetAlgorithm::vertices[VERTICES_DATALENGTH];
int PlanetAlgorithm::indexMap[INDEXMAP_DATALENGTH];
int PlanetAlgorithm::landIndex[LAND_DATALENGTH];

bool OpenCLManager::set_device_id(int input_device_id) {
    if (input_device_id >= 0) return false;
    SUPPORT_GPU = false;
    device_id = -1;
    ++cfg_version;
    return true;
}
