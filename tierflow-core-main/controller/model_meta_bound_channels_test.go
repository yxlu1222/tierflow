package controller

import (
	"testing"

	"github.com/Zer0Echo/tierflow-core/model"
	"github.com/stretchr/testify/require"
)

// 规则模型（前缀/后缀/包含匹配）的绑定渠道是从 map 收集后落成切片的，
// Go 的 map 迭代顺序随机 —— 不显式排序的话，同一份数据每次请求都会返回不同的渠道顺序，
// 前端徽章跟着每次刷新/翻页乱跳，管理员没法靠肉眼比对绑定关系有没有变。
func TestEnrichModelsSortsRuleModelBoundChannels(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	model.InvalidatePricingCache()
	t.Cleanup(model.InvalidatePricingCache)

	// id 顺序与名称字典序相反，避免"恰好按名字排"也能蒙混过关
	require.NoError(t, db.Create(&[]model.Channel{
		{Id: 7, Name: "zeta", Type: 1, Status: 1, Models: "zz-rule-a,zz-rule-b"},
		{Id: 3, Name: "yankee", Type: 1, Status: 1, Models: "zz-rule-a"},
		{Id: 9, Name: "xray", Type: 43, Status: 1, Models: "zz-rule-b"},
		{Id: 1, Name: "whiskey", Type: 1, Status: 1, Models: "zz-rule-a"},
	}).Error)
	require.NoError(t, db.Create(&[]model.Ability{
		{Group: "default", Model: "zz-rule-a", ChannelId: 7, Enabled: true},
		{Group: "default", Model: "zz-rule-a", ChannelId: 3, Enabled: true},
		{Group: "default", Model: "zz-rule-a", ChannelId: 1, Enabled: true},
		{Group: "default", Model: "zz-rule-b", ChannelId: 7, Enabled: true},
		{Group: "default", Model: "zz-rule-b", ChannelId: 9, Enabled: true},
	}).Error)

	var last []int
	for i := 0; i < 5; i++ { // 多跑几次，随机化的迭代顺序才暴露得出来
		m := &model.Model{ModelName: "zz-rule-", NameRule: model.NameRulePrefix}
		enrichModels([]*model.Model{m})
		require.NotEmpty(t, m.BoundChannels, "前缀规则应匹配到 zz-rule-a / zz-rule-b 的渠道")

		ids := make([]int, 0, len(m.BoundChannels))
		for _, ch := range m.BoundChannels {
			ids = append(ids, ch.Id)
		}
		require.IsIncreasingf(t, ids, "第 %d 次调用的渠道顺序不是按 id 升序: %v", i+1, ids)
		if last != nil {
			require.Equalf(t, last, ids, "第 %d 次调用与上次顺序不一致", i+1)
		}
		last = ids
	}
	require.Equal(t, []int{1, 3, 7, 9}, last)
}
