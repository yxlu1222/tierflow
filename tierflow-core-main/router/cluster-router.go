package router

import (
	"github.com/Zer0Echo/tierflow-core/controller"
	"github.com/Zer0Echo/tierflow-core/middleware"
	"github.com/gin-gonic/gin"
)

func SetClusterRouter(router *gin.Engine) {
	clusterRoute := router.Group("/api/cluster")
	clusterRoute.POST("/heartbeat", controller.ClusterHeartbeat)

	adminRoute := clusterRoute.Group("")
	adminRoute.Use(middleware.AdminAuth())
	{
		adminRoute.GET("/nodes", controller.GetClusterNodes)
		adminRoute.GET("/nodes/:id", controller.GetClusterNode)
		adminRoute.POST("/nodes", controller.CreateClusterNode)
		adminRoute.PUT("/nodes/:id", controller.UpdateClusterNode)
		adminRoute.DELETE("/nodes/:id", controller.DeleteClusterNode)
		adminRoute.POST("/nodes/:id/drain", controller.ClusterNodeDrain)
		adminRoute.POST("/nodes/:id/models/:model/actions", controller.ClusterNodeModelAction)
		adminRoute.GET("/nodes/:id/models/:model/logs", controller.ClusterNodeModelLogs)
		adminRoute.POST("/nodes/:id/models/:model/verify", controller.ClusterNodeModelVerify)
	}
	controller.StartClusterNodeMonitor()
}
