package controller

import (
	"strconv"
	"strings"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/model"

	"github.com/gin-gonic/gin"
)

// GetAllModelGroups 列出全部模型组（含成员）。
func GetAllModelGroups(c *gin.Context) {
	groups, err := model.GetAllModelGroups()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, groups)
}

// GetModelGroup 按 id 取单个模型组（含成员）。
func GetModelGroup(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "无效的 id")
		return
	}
	g, err := model.GetModelGroupById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, g)
}

// AddModelGroup 新建模型组。
func AddModelGroup(c *gin.Context) {
	var g model.ModelGroup
	if err := c.ShouldBindJSON(&g); err != nil {
		common.ApiError(c, err)
		return
	}
	g.Name = strings.TrimSpace(g.Name)
	if g.Name == "" {
		common.ApiErrorMsg(c, "名称不能为空")
		return
	}
	if err := model.AddModelGroup(&g, g.Members); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, g)
}

// UpdateModelGroup 更新模型组（全量字段 + 成员整体替换）。
func UpdateModelGroup(c *gin.Context) {
	var g model.ModelGroup
	if err := c.ShouldBindJSON(&g); err != nil {
		common.ApiError(c, err)
		return
	}
	if g.Id == 0 {
		common.ApiErrorMsg(c, "无效的 id")
		return
	}
	g.Name = strings.TrimSpace(g.Name)
	if g.Name == "" {
		common.ApiErrorMsg(c, "名称不能为空")
		return
	}
	if err := model.UpdateModelGroup(&g, g.Members); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, g)
}

// DeleteModelGroup 删除模型组。
func DeleteModelGroup(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "无效的 id")
		return
	}
	if err := model.DeleteModelGroupById(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"id": id})
}
