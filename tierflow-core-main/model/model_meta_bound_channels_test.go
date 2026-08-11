package model

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// 绑定渠道必须按渠道 id 稳定定序。
//
// 这批数据会被前端渲染成渠道徽章：顺序一抖动，管理员每次刷新/翻页看到的排列都不同，
// 没法靠肉眼比对某个模型的上游绑定有没有变。SQL 层不带 ORDER BY 就没有顺序保证 ——
// 实际顺序会随执行计划、索引与物理行序变化，本地看着稳定不代表线上稳定。
func TestGetBoundChannelsByModelsMapIsOrderedById(t *testing.T) {
	truncateTables(t)

	// 刻意乱序插入，且让 id 顺序与名称字典序相反，避免"恰好按名字排"也能蒙混过关
	require.NoError(t, DB.Create(&[]Channel{
		{Id: 7, Name: "zeta", Type: 1},
		{Id: 3, Name: "yankee", Type: 1},
		{Id: 9, Name: "xray", Type: 43},
		{Id: 1, Name: "whiskey", Type: 1},
	}).Error)
	require.NoError(t, DB.Create(&[]Ability{
		{Group: "default", Model: "m-1", ChannelId: 7, Enabled: true},
		{Group: "vip", Model: "m-1", ChannelId: 7, Enabled: true}, // 同渠道多分组：DISTINCT 后仍应只有一条
		{Group: "default", Model: "m-1", ChannelId: 3, Enabled: true},
		{Group: "default", Model: "m-1", ChannelId: 9, Enabled: true},
		{Group: "default", Model: "m-1", ChannelId: 1, Enabled: true},
	}).Error)

	for i := 0; i < 5; i++ { // 多跑几次，随机化的迭代顺序才暴露得出来
		got, err := GetBoundChannelsByModelsMap([]string{"m-1"})
		require.NoError(t, err)
		ids := make([]int, 0, len(got["m-1"]))
		for _, ch := range got["m-1"] {
			ids = append(ids, ch.Id)
		}
		require.Equal(t, []int{1, 3, 7, 9}, ids, "第 %d 次调用顺序不一致", i+1)
	}
}
