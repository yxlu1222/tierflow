package model

import "errors"

// Common errors
var (
	ErrDatabase = errors.New("database error")
)

// User auth errors
var (
	ErrInvalidCredentials   = errors.New("invalid credentials")
	ErrUserEmptyCredentials = errors.New("empty credentials")
)

// Token auth errors
var (
	ErrTokenNotProvided = errors.New("token not provided")
	ErrTokenInvalid     = errors.New("token invalid")
)

// Redemption errors
//
// ErrRedeemFailed 是兜底错误(未知/数据库故障)。其余哨兵对应用户可据此行动的
// 具体原因 —— controller 层用 errors.Is 分派到对应 i18n 文案。历史上所有失败
// 都被折叠成 ErrRedeemFailed，用户只能看到「兑换失败，请稍后重试」，订阅码
// 引入的失败原因更多，必须可区分。
var (
	ErrRedeemFailed       = errors.New("redeem.failed")
	ErrRedemptionInvalid  = errors.New("redemption invalid")
	ErrRedemptionUsed     = errors.New("redemption already used")
	ErrRedemptionDisabled = errors.New("redemption disabled")
	ErrRedemptionExpired  = errors.New("redemption expired")

	// ErrRedemptionUserMissing:兑换目标账号不存在或已被软删除(额度 UPDATE 影响 0 行)。
	// 刻意【不】列入 isRedeemUserFacingError —— 账号都没了，给用户一句具体文案没有意义，
	// 折叠成兜底提示即可;它存在的价值是让事务回滚、兑换码保持可用,并在日志里可辨认。
	ErrRedemptionUserMissing = errors.New("redemption target user missing")

	// 订阅码特有
	ErrRedemptionPlanMissing  = errors.New("redemption plan not found")
	ErrRedemptionPlanDisabled = errors.New("redemption plan disabled")
)

// 2FA errors
var ErrTwoFANotEnabled = errors.New("2fa not enabled")
