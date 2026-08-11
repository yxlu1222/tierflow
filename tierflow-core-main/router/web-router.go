package router

import (
	"embed"
	"net/http"
	"os"
	"strings"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/controller"
	"github.com/Zer0Echo/tierflow-core/middleware"
	"github.com/gin-contrib/gzip"
	"github.com/gin-contrib/static"
	"github.com/gin-gonic/gin"
)

// ThemeAssets holds the embedded frontend assets.
type ThemeAssets struct {
	DefaultBuildFS   embed.FS
	DefaultIndexPage []byte
}

func SetWebRouter(router *gin.Engine, assets ThemeAssets) {
	themeFS := common.EmbedFolder(assets.DefaultBuildFS, "web/default/dist")

	router.Use(gzip.Gzip(gzip.DefaultCompression))
	router.Use(middleware.GlobalWebRateLimit())
	router.Use(middleware.Cache())
	// Serve operator-supplied static assets (logo, favicon, etc.) from a
	// host-mounted directory when STATIC_ROOT is set. Registered before the
	// embedded assets so a file on disk overrides the built-in one; missing
	// files fall through to the embedded FS and then the SPA fallback below.
	// If STATIC_ROOT is unset or not a directory, behaviour is unchanged.
	if staticRoot := strings.TrimSpace(os.Getenv("STATIC_ROOT")); staticRoot != "" {
		if info, err := os.Stat(staticRoot); err == nil && info.IsDir() {
			router.Use(static.Serve("/", static.LocalFile(staticRoot, false)))
			common.SysLog("serving operator static assets from " + staticRoot)
		} else {
			common.SysLog("STATIC_ROOT is set but not a usable directory, skipping: " + staticRoot)
		}
	}
	router.Use(static.Serve("/", themeFS))
	router.NoRoute(func(c *gin.Context) {
		c.Set(middleware.RouteTagKey, "web")
		if strings.HasPrefix(c.Request.RequestURI, "/v1") || strings.HasPrefix(c.Request.RequestURI, "/api") || strings.HasPrefix(c.Request.RequestURI, "/assets") {
			controller.RelayNotFound(c)
			return
		}
		c.Header("Cache-Control", "no-cache")
		c.Data(http.StatusOK, "text/html; charset=utf-8", assets.DefaultIndexPage)
	})
}
