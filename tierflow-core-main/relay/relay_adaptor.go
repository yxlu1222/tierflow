package relay

import (
	"github.com/Zer0Echo/tierflow-core/constant"
	"github.com/Zer0Echo/tierflow-core/relay/channel"
	"github.com/Zer0Echo/tierflow-core/relay/channel/ali"
	"github.com/Zer0Echo/tierflow-core/relay/channel/aws"
	"github.com/Zer0Echo/tierflow-core/relay/channel/baidu"
	"github.com/Zer0Echo/tierflow-core/relay/channel/baidu_v2"
	"github.com/Zer0Echo/tierflow-core/relay/channel/claude"
	"github.com/Zer0Echo/tierflow-core/relay/channel/cloudflare"
	"github.com/Zer0Echo/tierflow-core/relay/channel/codex"
	"github.com/Zer0Echo/tierflow-core/relay/channel/cohere"
	"github.com/Zer0Echo/tierflow-core/relay/channel/coze"
	"github.com/Zer0Echo/tierflow-core/relay/channel/deepseek"
	"github.com/Zer0Echo/tierflow-core/relay/channel/dify"
	"github.com/Zer0Echo/tierflow-core/relay/channel/gemini"
	"github.com/Zer0Echo/tierflow-core/relay/channel/jimeng"
	"github.com/Zer0Echo/tierflow-core/relay/channel/jina"
	"github.com/Zer0Echo/tierflow-core/relay/channel/minimax"
	"github.com/Zer0Echo/tierflow-core/relay/channel/mistral"
	"github.com/Zer0Echo/tierflow-core/relay/channel/mokaai"
	"github.com/Zer0Echo/tierflow-core/relay/channel/moonshot"
	"github.com/Zer0Echo/tierflow-core/relay/channel/ollama"
	"github.com/Zer0Echo/tierflow-core/relay/channel/openai"
	"github.com/Zer0Echo/tierflow-core/relay/channel/palm"
	"github.com/Zer0Echo/tierflow-core/relay/channel/perplexity"
	"github.com/Zer0Echo/tierflow-core/relay/channel/replicate"
	"github.com/Zer0Echo/tierflow-core/relay/channel/siliconflow"
	"github.com/Zer0Echo/tierflow-core/relay/channel/submodel"
	"github.com/Zer0Echo/tierflow-core/relay/channel/tencent"
	"github.com/Zer0Echo/tierflow-core/relay/channel/vertex"
	"github.com/Zer0Echo/tierflow-core/relay/channel/volcengine"
	"github.com/Zer0Echo/tierflow-core/relay/channel/xai"
	"github.com/Zer0Echo/tierflow-core/relay/channel/xunfei"
	"github.com/Zer0Echo/tierflow-core/relay/channel/zhipu"
	"github.com/Zer0Echo/tierflow-core/relay/channel/zhipu_4v"
)

func GetAdaptor(apiType int) channel.Adaptor {
	switch apiType {
	case constant.APITypeAli:
		return &ali.Adaptor{}
	case constant.APITypeAnthropic:
		return &claude.Adaptor{}
	case constant.APITypeBaidu:
		return &baidu.Adaptor{}
	case constant.APITypeGemini:
		return &gemini.Adaptor{}
	case constant.APITypeOpenAI:
		return &openai.Adaptor{}
	case constant.APITypePaLM:
		return &palm.Adaptor{}
	case constant.APITypeTencent:
		return &tencent.Adaptor{}
	case constant.APITypeXunfei:
		return &xunfei.Adaptor{}
	case constant.APITypeZhipu:
		return &zhipu.Adaptor{}
	case constant.APITypeZhipuV4:
		return &zhipu_4v.Adaptor{}
	case constant.APITypeOllama:
		return &ollama.Adaptor{}
	case constant.APITypePerplexity:
		return &perplexity.Adaptor{}
	case constant.APITypeAws:
		return &aws.Adaptor{}
	case constant.APITypeCohere:
		return &cohere.Adaptor{}
	case constant.APITypeDify:
		return &dify.Adaptor{}
	case constant.APITypeJina:
		return &jina.Adaptor{}
	case constant.APITypeCloudflare:
		return &cloudflare.Adaptor{}
	case constant.APITypeSiliconFlow:
		return &siliconflow.Adaptor{}
	case constant.APITypeVertexAi:
		return &vertex.Adaptor{}
	case constant.APITypeMistral:
		return &mistral.Adaptor{}
	case constant.APITypeDeepSeek:
		return &deepseek.Adaptor{}
	case constant.APITypeMokaAI:
		return &mokaai.Adaptor{}
	case constant.APITypeVolcEngine:
		return &volcengine.Adaptor{}
	case constant.APITypeBaiduV2:
		return &baidu_v2.Adaptor{}
	case constant.APITypeOpenRouter:
		return &openai.Adaptor{}
	case constant.APITypeXinference:
		return &openai.Adaptor{}
	case constant.APITypeXai:
		return &xai.Adaptor{}
	case constant.APITypeCoze:
		return &coze.Adaptor{}
	case constant.APITypeJimeng:
		return &jimeng.Adaptor{}
	case constant.APITypeMoonshot:
		return &moonshot.Adaptor{} // Moonshot uses Claude API
	case constant.APITypeSubmodel:
		return &submodel.Adaptor{}
	case constant.APITypeMiniMax:
		return &minimax.Adaptor{}
	case constant.APITypeReplicate:
		return &replicate.Adaptor{}
	case constant.APITypeCodex:
		return &codex.Adaptor{}
	}
	return nil
}
