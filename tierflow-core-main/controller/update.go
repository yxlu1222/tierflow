package controller

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/logger"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
)

// 自更新配置（环境变量，部署时在 compose 注入）：
//
//	UPDATE_REPO            版本来源 GitHub 仓库（owner/name），check 取其最新 release tag。默认本项目。
//	UPDATE_GITHUB_TOKEN    可选；私有库或避免限流时带上。
//	WATCHTOWER_URL         watchtower HTTP 触发地址（默认容器内 http://watchtower:8080/v1/update）。
//	WATCHTOWER_TOKEN       watchtower HTTP API token（与 watchtower 侧 WATCHTOWER_HTTP_API_TOKEN 一致）。
func updateConfig() (repo, ghToken, wtURL, wtToken string) {
	repo = common.GetEnvOrDefaultString("UPDATE_REPO", "Zer0Echo/tierflow-core")
	ghToken = common.GetEnvOrDefaultString("UPDATE_GITHUB_TOKEN", "")
	wtURL = common.GetEnvOrDefaultString("WATCHTOWER_URL", "http://watchtower:8080/v1/update")
	wtToken = common.GetEnvOrDefaultString("WATCHTOWER_TOKEN", "")
	return
}

type githubRelease struct {
	TagName     string `json:"tag_name"`
	Name        string `json:"name"`
	Body        string `json:"body"`
	HtmlURL     string `json:"html_url"`
	PublishedAt string `json:"published_at"`
}

// CheckUpdate 取版本来源仓库的最新 release tag，与当前运行版本比较。仅管理员可用。
func CheckUpdate(c *gin.Context) {
	repo, ghToken, _, _ := updateConfig()

	apiURL := fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", repo)
	req, err := http.NewRequest(http.MethodGet, apiURL, nil)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "tierflow-update-checker")
	if ghToken != "" {
		req.Header.Set("Authorization", "Bearer "+ghToken)
	}

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无法访问发布源: " + err.Error()})
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == http.StatusNotFound {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": fmt.Sprintf("仓库 %s 尚无已发布的 release(请先打 v* tag 触发发布)", repo)})
		return
	}
	if resp.StatusCode != http.StatusOK {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": fmt.Sprintf("发布源返回 %d: %s", resp.StatusCode, common.LocalLogPreview(string(body)))})
		return
	}

	var release githubRelease
	if err := common.Unmarshal(body, &release); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "解析发布信息失败: " + err.Error()})
		return
	}
	if release.TagName == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "发布源未返回有效版本"})
		return
	}

	current := common.Version
	hasUpdate := isNewerVersion(release.TagName, current)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"current_version": current,
			"latest_version":  release.TagName,
			"has_update":      hasUpdate,
			"name":            release.Name,
			"notes":           release.Body,
			"url":             release.HtmlURL,
			"published_at":    release.PublishedAt,
		},
	})
}

// PerformUpdate 触发 watchtower 拉取最新镜像并重建本容器。仅管理员可用。
// 注意：watchtower 重建 tierflow-api 时本进程会被杀，因此这里只“派发触发”后立即返回，
// 前端靠轮询 /api/status 判断新版本是否起来，而不是等本请求的响应。
func PerformUpdate(c *gin.Context) {
	_, _, wtURL, wtToken := updateConfig()
	if wtURL == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "未配置 WATCHTOWER_URL"})
		return
	}

	// 先快速探测 watchtower 是否可达，避免“假装触发成功”
	if host := hostPortFromURL(wtURL); host != "" {
		conn, err := net.DialTimeout("tcp", host, 3*time.Second)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "更新执行器(watchtower)不可达: " + err.Error()})
			return
		}
		_ = conn.Close()
	}

	// 派发触发（异步）：watchtower 会拉镜像后重建本容器，本进程随即被杀。
	gopool.Go(func() {
		req, err := http.NewRequest(http.MethodPost, wtURL, nil)
		if err != nil {
			logger.LogError(c.Request.Context(), "perform update: build request failed: "+err.Error())
			return
		}
		if wtToken != "" {
			req.Header.Set("Authorization", "Bearer "+wtToken)
		}
		client := &http.Client{Timeout: 5 * time.Minute}
		resp, err := client.Do(req)
		if err != nil {
			// 多半是 watchtower 已开始重建本容器、连接被切断，更新通常仍在进行。
			logger.LogInfo(c.Request.Context(), "perform update: trigger dispatched (connection ended: "+err.Error()+")")
			return
		}
		defer resp.Body.Close()
		logger.LogInfo(c.Request.Context(), fmt.Sprintf("perform update: watchtower responded %d", resp.StatusCode))
	})

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "更新已触发，服务将拉取新镜像并重启，请稍候。",
	})
}

// hostPortFromURL 从 URL 取 host:port（补默认端口），用于可达性探测。
func hostPortFromURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ""
	}
	if u.Port() != "" {
		return u.Host
	}
	if u.Scheme == "https" {
		return u.Hostname() + ":443"
	}
	return u.Hostname() + ":80"
}

// isNewerVersion 判断 latest 是否比 current 新。优先按 semver 数字比较（容忍前缀 v 及
// -suffix）；无法解析时退化为“字符串不等即视为有更新”。
func isNewerVersion(latest, current string) bool {
	lv, lok := parseSemver(latest)
	cv, cok := parseSemver(current)
	if lok && cok {
		for i := 0; i < 3; i++ {
			if lv[i] != cv[i] {
				return lv[i] > cv[i]
			}
		}
		return false
	}
	return normalizeVersion(latest) != normalizeVersion(current)
}

func normalizeVersion(v string) string {
	v = strings.TrimSpace(v)
	v = strings.TrimPrefix(v, "v")
	v = strings.TrimPrefix(v, "V")
	return v
}

// parseSemver 解析 "v1.2.3" / "1.2.3-rc1" 为 [3]int，取主.次.修订，忽略后缀。
func parseSemver(v string) ([3]int, bool) {
	v = normalizeVersion(v)
	if i := strings.IndexAny(v, "-+ "); i >= 0 {
		v = v[:i]
	}
	parts := strings.Split(v, ".")
	if len(parts) == 0 || len(parts) > 3 {
		return [3]int{}, false
	}
	var out [3]int
	for i := 0; i < len(parts); i++ {
		n, err := strconv.Atoi(parts[i])
		if err != nil {
			return [3]int{}, false
		}
		out[i] = n
	}
	return out, true
}
