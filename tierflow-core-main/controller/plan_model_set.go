package controller

import (
	"strconv"
	"strings"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/model"

	"github.com/gin-gonic/gin"
)

// 套餐模型组(PlanModelSet)管理端 CRUD。骨架与 controller/model_group.go 一致:
// 成员(引用的模型组)随组整体读写,校验在 model 层。

// GetAllPlanModelSets 列出全部套餐模型组(含成员)。
func GetAllPlanModelSets(c *gin.Context) {
	sets, err := model.GetAllPlanModelSets()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, sets)
}

// GetPlanModelSet 按 id 取单个套餐模型组(含成员)。
func GetPlanModelSet(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "无效的 id")
		return
	}
	s, err := model.GetPlanModelSetById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, s)
}

// AddPlanModelSet 新建套餐模型组。
func AddPlanModelSet(c *gin.Context) {
	var s model.PlanModelSet
	if err := c.ShouldBindJSON(&s); err != nil {
		common.ApiError(c, err)
		return
	}
	s.Name = strings.TrimSpace(s.Name)
	if s.Name == "" {
		common.ApiErrorMsg(c, "名称不能为空")
		return
	}
	if err := model.AddPlanModelSet(&s, s.Members); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, s)
}

// UpdatePlanModelSet 更新套餐模型组(全量字段 + 成员整体替换)。
func UpdatePlanModelSet(c *gin.Context) {
	var s model.PlanModelSet
	if err := c.ShouldBindJSON(&s); err != nil {
		common.ApiError(c, err)
		return
	}
	if s.Id == 0 {
		common.ApiErrorMsg(c, "无效的 id")
		return
	}
	s.Name = strings.TrimSpace(s.Name)
	if s.Name == "" {
		common.ApiErrorMsg(c, "名称不能为空")
		return
	}
	if err := model.UpdatePlanModelSet(&s, s.Members); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, s)
}

// DeletePlanModelSet 删除套餐模型组(被套餐引用时拒绝)。
func DeletePlanModelSet(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "无效的 id")
		return
	}
	if err := model.DeletePlanModelSetById(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"id": id})
}
