package deepseek

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/dto"
	"github.com/Zer0Echo/tierflow-core/relay/channel"
	"github.com/Zer0Echo/tierflow-core/relay/channel/claude"
	"github.com/Zer0Echo/tierflow-core/relay/channel/openai"
	relaycommon "github.com/Zer0Echo/tierflow-core/relay/common"
	"github.com/Zer0Echo/tierflow-core/relay/constant"
	"github.com/Zer0Echo/tierflow-core/service"
	"github.com/Zer0Echo/tierflow-core/setting/reasoning"
	"github.com/Zer0Echo/tierflow-core/types"
	"github.com/gin-gonic/gin"
)

type Adaptor struct {
}

func (a *Adaptor) ConvertGeminiRequest(*gin.Context, *relaycommon.RelayInfo, *dto.GeminiChatRequest) (any, error) {
	//TODO implement me
	return nil, errors.New("not implemented")
}

func (a *Adaptor) ConvertClaudeRequest(c *gin.Context, info *relaycommon.RelayInfo, req *dto.ClaudeRequest) (any, error) {
	adaptor := claude.Adaptor{}
	convertedRequest, err := adaptor.ConvertClaudeRequest(c, info, req)
	if err != nil {
		return nil, err
	}
	claudeRequest, ok := convertedRequest.(*dto.ClaudeRequest)
	if !ok {
		return convertedRequest, nil
	}
	if err := applyDeepSeekV4ClaudeThinkingSuffix(info, claudeRequest); err != nil {
		return nil, err
	}
	return claudeRequest, nil
}

func (a *Adaptor) ConvertAudioRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	//TODO implement me
	return nil, errors.New("not implemented")
}

func (a *Adaptor) ConvertImageRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.ImageRequest) (any, error) {
	//TODO implement me
	return nil, errors.New("not implemented")
}

func (a *Adaptor) Init(info *relaycommon.RelayInfo) {
}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	fimBaseUrl := info.ChannelBaseUrl
	switch info.RelayFormat {
	case types.RelayFormatClaude:
		return fmt.Sprintf("%s/anthropic/v1/messages", info.ChannelBaseUrl), nil
	default:
		if !strings.HasSuffix(info.ChannelBaseUrl, "/beta") {
			fimBaseUrl += "/beta"
		}
		switch info.RelayMode {
		case constant.RelayModeCompletions:
			return fmt.Sprintf("%s/completions", fimBaseUrl), nil
		default:
			return fmt.Sprintf("%s/v1/chat/completions", info.ChannelBaseUrl), nil
		}
	}
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Header, info *relaycommon.RelayInfo) error {
	channel.SetupApiRequestHeader(info, c, req)
	req.Set("Authorization", "Bearer "+info.ApiKey)
	return nil
}

func (a *Adaptor) ConvertOpenAIRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	if err := applyDeepSeekV4OpenAIThinkingSuffix(info, request); err != nil {
		return nil, err
	}

	// TierFlow: DeepSeek 思考模式多轮要求【发生过工具调用的对话】里的 assistant 历史带回
	// reasoning_content，否则 400 "The reasoning_content in the thinking mode must be passed back to the API."
	// 这是 DeepSeek 上游的协议要求，不是站点偏好 —— 所以按渠道类型内建、零配置生效，
	// 不再依赖任何系统选项(旧的 ReasoningContinuityModels 默认为空，等于这条兜底从未跑过)。
	//
	// 客户端(WorkBuddy / Codex 等)重建历史时会剥掉这个非 OpenAI 标准字段，跨模型按步路由
	// (如 qwen3.5-flash → deepseek-v4-flash)则本就没有该字段，两种场景都靠这里补齐。
	modelName := info.UpstreamModelName
	if modelName == "" {
		modelName = request.Model
	}
	if service.NeedsReasoningContinuity(info.ChannelType, modelName) && !deepSeekThinkingDisabled(request) {
		service.ApplyReasoningContinuity(info.UserId, modelName, request.Messages)
	}

	return request, nil
}

// deepSeekThinkingDisabled 判断本次请求是否显式关闭了思考模式(模型名 -none 后缀会被
// applyDeepSeekV4OpenAIThinkingSuffix 翻译成 thinking:{"type":"disabled"})。
// 关闭思考时上游不要求回传 reasoning_content，注入反而是多余的拒收风险。
func deepSeekThinkingDisabled(request *dto.GeneralOpenAIRequest) bool {
	if len(request.THINKING) == 0 {
		return false
	}
	var thinking struct {
		Type string `json:"type"`
	}
	if err := common.Unmarshal(request.THINKING, &thinking); err != nil {
		return false
	}
	return thinking.Type == "disabled"
}

func applyDeepSeekV4OpenAIThinkingSuffix(info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) error {
	modelName := request.Model
	if info != nil && info.ChannelMeta != nil && info.UpstreamModelName != "" {
		modelName = info.UpstreamModelName
	}
	baseModel, thinkingType, effort, ok := reasoning.ParseDeepSeekV4ThinkingSuffix(modelName)
	if !ok {
		return nil
	}
	thinking, err := common.Marshal(map[string]string{
		"type": thinkingType,
	})
	if err != nil {
		return fmt.Errorf("error marshalling thinking: %w", err)
	}
	request.Model = baseModel
	request.THINKING = thinking
	request.ReasoningEffort = effort
	if info != nil {
		if info.ChannelMeta != nil {
			info.UpstreamModelName = baseModel
		}
		info.ReasoningEffort = effort
	}
	return nil
}

func applyDeepSeekV4ClaudeThinkingSuffix(info *relaycommon.RelayInfo, request *dto.ClaudeRequest) error {
	modelName := request.Model
	if info != nil && info.ChannelMeta != nil && info.UpstreamModelName != "" {
		modelName = info.UpstreamModelName
	}
	baseModel, thinkingType, effort, ok := reasoning.ParseDeepSeekV4ThinkingSuffix(modelName)
	if !ok {
		return nil
	}
	request.Model = baseModel
	request.Thinking = &dto.Thinking{Type: thinkingType}
	if effort == "" {
		request.OutputConfig = nil
	} else {
		outputConfig, err := common.Marshal(map[string]string{
			"effort": effort,
		})
		if err != nil {
			return fmt.Errorf("error marshalling output_config: %w", err)
		}
		request.OutputConfig = outputConfig
	}
	if info != nil {
		if info.ChannelMeta != nil {
			info.UpstreamModelName = baseModel
		}
		info.ReasoningEffort = effort
	}
	return nil
}

func (a *Adaptor) ConvertRerankRequest(c *gin.Context, relayMode int, request dto.RerankRequest) (any, error) {
	return nil, nil
}

func (a *Adaptor) ConvertEmbeddingRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	//TODO implement me
	return nil, errors.New("not implemented")
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.OpenAIResponsesRequest) (any, error) {
	// TODO implement me
	return nil, errors.New("not implemented")
}

func (a *Adaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (any, error) {
	return channel.DoApiRequest(a, c, info, requestBody)
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (usage any, err *types.NewAPIError) {
	switch info.RelayFormat {
	case types.RelayFormatClaude:
		adaptor := claude.Adaptor{}
		return adaptor.DoResponse(c, resp, info)
	default:
		adaptor := openai.Adaptor{}
		return adaptor.DoResponse(c, resp, info)
	}
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}
