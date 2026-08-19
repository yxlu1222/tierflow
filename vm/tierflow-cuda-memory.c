#define _GNU_SOURCE

#include <dlfcn.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

typedef int CUresult;
typedef int CUdevice;
typedef void *CUcontext;

typedef CUresult (*cu_init_fn)(unsigned int);
typedef CUresult (*cu_device_get_fn)(CUdevice *, int);
typedef CUresult (*cu_ctx_create_fn)(CUcontext *, unsigned int, CUdevice);
typedef CUresult (*cu_ctx_destroy_fn)(CUcontext);
typedef CUresult (*cu_mem_get_info_fn)(size_t *, size_t *);

static void *load_symbol(void *library, const char *name) {
    void *symbol = dlsym(library, name);
    if (symbol == NULL) {
        fprintf(stderr, "tierflow-cuda-memory: missing CUDA symbol %s\n", name);
    }
    return symbol;
}

int main(int argc, char **argv) {
    long device_index = 0;
    if (argc > 1) {
        char *end = NULL;
        errno = 0;
        device_index = strtol(argv[1], &end, 10);
        if (errno != 0 || end == argv[1] || *end != '\0' || device_index < 0 || device_index > INT32_MAX) {
            fprintf(stderr, "tierflow-cuda-memory: invalid GPU index\n");
            return 2;
        }
    }

    void *library = dlopen("libcuda.so.1", RTLD_NOW | RTLD_LOCAL);
    if (library == NULL) {
        fprintf(stderr, "tierflow-cuda-memory: %s\n", dlerror());
        return 3;
    }

    cu_init_fn cu_init = (cu_init_fn) load_symbol(library, "cuInit");
    cu_device_get_fn cu_device_get = (cu_device_get_fn) load_symbol(library, "cuDeviceGet");
    cu_ctx_create_fn cu_ctx_create = (cu_ctx_create_fn) load_symbol(library, "cuCtxCreate_v2");
    cu_ctx_destroy_fn cu_ctx_destroy = (cu_ctx_destroy_fn) load_symbol(library, "cuCtxDestroy_v2");
    cu_mem_get_info_fn cu_mem_get_info = (cu_mem_get_info_fn) load_symbol(library, "cuMemGetInfo_v2");
    if (cu_init == NULL || cu_device_get == NULL || cu_ctx_create == NULL || cu_ctx_destroy == NULL || cu_mem_get_info == NULL) {
        dlclose(library);
        return 4;
    }

    CUdevice device = 0;
    CUcontext context = NULL;
    size_t free_bytes = 0;
    size_t total_bytes = 0;
    if (cu_init(0) != 0 || cu_device_get(&device, (int) device_index) != 0 || cu_ctx_create(&context, 0, device) != 0) {
        dlclose(library);
        return 5;
    }
    CUresult result = cu_mem_get_info(&free_bytes, &total_bytes);
    cu_ctx_destroy(context);
    dlclose(library);
    if (result != 0 || total_bytes == 0 || free_bytes > total_bytes) {
        return 6;
    }

    printf("%zu %zu\n", total_bytes, free_bytes);
    return 0;
}
