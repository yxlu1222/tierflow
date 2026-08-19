# Ling-3.0-tiny DGX Spark deployment notes

## Verified model identity

- Official repository: `inclusionAI/Ling-3.0-tiny`
- Official FP8 repository: `inclusionAI/Ling-3.0-tiny-fp8`
- License: MIT
- Architecture: hybrid KDA/MLA sparse MoE
- Total parameters: 7.9B
- Activated parameters per token: 1.4B (1.14B excluding embeddings)
- Native context length: 128K
- Thinking mode: enabled by default; controllable with `chat_template_kwargs.enable_thinking`
- Recommended sampling: temperature 1.0, top-p 0.95, top-k 20

## DGX Spark relevance

The official model card explicitly lists NVIDIA DGX Spark as a validated local-deployment target. It reports approximately 100–105 output tokens/s for FP8 at an 8K context length, with roughly 8.34 GiB peak memory use. This is a vendor-reported reference point and must be remeasured through TierFlow on the actual appliance.

## Selected runtime

SGLang is selected instead of a generic released vLLM build because Ling 3.0 currently requires model-specific runtime support. The official image is `lmsysorg/sglang:dev-Ling-3.0-tiny`. Appliance validation showed that the model-specific `ling3` reasoning and tool-call parsers are required for correct OpenAI-compatible content, reasoning, and streamed tool-call deltas; the older generic `deepseek-r1` and `glm45` parser combination is not used.

The model card currently shows an older NEXTN/256K example, while the more specific SGLang Cookbook states that Ling-3.0-tiny has `num_nextn_predict_layers: 0`, does not support NEXTN speculative decoding, and has a native 128K context. The appliance configuration follows the current Cookbook and checkpoint architecture rather than forcing the older example.

The TierFlow service uses port 8106 and the public model ID `Ling-3.0-tiny`. It is mutually exclusive with the larger local model services through systemd and `tierflow-model-switch`, preventing unified-memory exhaustion. Static serving memory is initially capped at 40% of unified memory, leaving adequate capacity for the operating system and TierFlow while retaining room for eight concurrent requests.

The installer prefers the Hugging Face official repository and automatically falls back to the matching official InclusionAI repository on ModelScope when the appliance network cannot reach Hugging Face. Both paths install the FP8 checkpoint under the same immutable local model directory.

## Sources

- Official model card: https://huggingface.co/inclusionAI/Ling-3.0-tiny
- Official FP8 weights: https://huggingface.co/inclusionAI/Ling-3.0-tiny-fp8
- Official SGLang cookbook linked by the model card: https://docs.sglang.io/cookbook/autoregressive/InclusionAI/Ling-3.0-tiny
