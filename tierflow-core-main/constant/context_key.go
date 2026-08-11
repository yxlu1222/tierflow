package constant

type ContextKey string

const (
	ContextKeyTokenCountMeta  ContextKey = "token_count_meta"
	ContextKeyPromptTokens    ContextKey = "prompt_tokens"
	ContextKeyEstimatedTokens ContextKey = "estimated_tokens"

	ContextKeyOriginalModel    ContextKey = "original_model"
	ContextKeyRequestStartTime ContextKey = "request_start_time"

	/* token related keys */
	ContextKeyTokenUnlimited      ContextKey = "token_unlimited_quota"
	ContextKeyTokenKey            ContextKey = "token_key"
	ContextKeyTokenSubscriptionId ContextKey = "token_subscription_id"
	// ContextKeySubscriptionBucket:套餐门禁(subscription_gate)判定出的额度桶。
	// 门禁按模型组 id 精确判定,且可能主动降级换组,是本次请求的权威结果;
	// 计费层优先采信它,不要再按最终模型名反查一遍(两条路径会分叉)。
	ContextKeySubscriptionBucket     ContextKey = "subscription_bucket"
	ContextKeyTokenId                ContextKey = "token_id"
	ContextKeyTokenGroup             ContextKey = "token_group"
	ContextKeyTokenSpecificChannelId ContextKey = "specific_channel_id"
	ContextKeyTokenModelLimitEnabled ContextKey = "token_model_limit_enabled"
	ContextKeyTokenModelLimit        ContextKey = "token_model_limit"
	ContextKeyTokenCrossGroupRetry   ContextKey = "token_cross_group_retry"

	/* channel related keys */
	ContextKeyChannelId                ContextKey = "channel_id"
	ContextKeyChannelName              ContextKey = "channel_name"
	ContextKeyChannelCreateTime        ContextKey = "channel_create_time"
	ContextKeyChannelBaseUrl           ContextKey = "base_url"
	ContextKeyChannelType              ContextKey = "channel_type"
	ContextKeyChannelSetting           ContextKey = "channel_setting"
	ContextKeyChannelOtherSetting      ContextKey = "channel_other_setting"
	ContextKeyChannelParamOverride     ContextKey = "param_override"
	ContextKeyChannelHeaderOverride    ContextKey = "header_override"
	ContextKeyChannelOrganization      ContextKey = "channel_organization"
	ContextKeyChannelAutoBan           ContextKey = "auto_ban"
	ContextKeyChannelModelMapping      ContextKey = "model_mapping"
	ContextKeyChannelStatusCodeMapping ContextKey = "status_code_mapping"
	ContextKeyChannelIsMultiKey        ContextKey = "channel_is_multi_key"
	ContextKeyChannelMultiKeyIndex     ContextKey = "channel_multi_key_index"
	ContextKeyChannelKey               ContextKey = "channel_key"

	ContextKeyAutoGroup           ContextKey = "auto_group"
	ContextKeyAutoGroupIndex      ContextKey = "auto_group_index"
	ContextKeyAutoGroupRetryIndex ContextKey = "auto_group_retry_index"

	/* model-group routing keys (G2) */
	// ContextKeyModelGroupMembers 存放路由命中的模型组成员列表(有序,已按优先级排),
	// 类型 []model.ModelGroupMember。每个成员是 (channelId, upstreamModelName)。
	ContextKeyModelGroupMembers ContextKey = "model_group_members"
	// ContextKeyModelGroupMemberIndex 记录当前尝试到第几个成员(故障转移游标)。
	ContextKeyModelGroupMemberIndex ContextKey = "model_group_member_index"
	// ContextKeyAllowedChannelIds 约束本次渠道选择只能落在此集合内(map[int]bool)。
	// nil = 不约束。模型组路由用它把候选限定在组成员渠道内。
	ContextKeyAllowedChannelIds ContextKey = "allowed_channel_ids"

	/* user related keys */
	ContextKeyUserId      ContextKey = "id"
	ContextKeyUserSetting ContextKey = "user_setting"
	ContextKeyUserQuota   ContextKey = "user_quota"
	ContextKeyUserStatus  ContextKey = "user_status"
	ContextKeyUserEmail   ContextKey = "user_email"
	ContextKeyUserGroup   ContextKey = "user_group"
	ContextKeyUsingGroup  ContextKey = "group"
	ContextKeyUserName    ContextKey = "username"

	ContextKeyLocalCountTokens ContextKey = "local_count_tokens"

	ContextKeySystemPromptOverride ContextKey = "system_prompt_override"

	// ContextKeyFileSourcesToCleanup stores file sources that need cleanup when request ends
	ContextKeyFileSourcesToCleanup ContextKey = "file_sources_to_cleanup"

	// ContextKeyAdminRejectReason stores an admin-only reject/block reason extracted from upstream responses.
	// It is not returned to end users, but can be persisted into consume/error logs for debugging.
	ContextKeyAdminRejectReason ContextKey = "admin_reject_reason"

	// ContextKeyLanguage stores the user's language preference for i18n
	ContextKeyLanguage ContextKey = "language"
	ContextKeyIsStream ContextKey = "is_stream"
)
