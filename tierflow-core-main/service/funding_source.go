package service

import (
	"time"

	"github.com/Zer0Echo/tierflow-core/model"
	relaycommon "github.com/Zer0Echo/tierflow-core/relay/common"
)

// ---------------------------------------------------------------------------
// FundingSource — 资金来源接口（钱包 or 订阅）
// ---------------------------------------------------------------------------

// FundingSource 抽象了预扣费的资金来源。
type FundingSource interface {
	// Source 返回资金来源标识："wallet" 或 "subscription"
	Source() string
	// PreConsume 从该资金来源预扣 amount 额度
	PreConsume(amount int) error
	// Settle 根据差额调整资金来源（正数补扣，负数退还）
	Settle(delta int) error
	// Refund 退还所有预扣费
	Refund() error
}

// ---------------------------------------------------------------------------
// WalletFunding — 钱包资金来源实现
// ---------------------------------------------------------------------------

type WalletFunding struct {
	userId   int
	consumed int // 实际预扣的用户额度
}

func (w *WalletFunding) Source() string { return BillingSourceWallet }

func (w *WalletFunding) PreConsume(amount int) error {
	if amount <= 0 {
		return nil
	}
	if err := model.DecreaseUserQuota(w.userId, amount, false); err != nil {
		return err
	}
	w.consumed = amount
	return nil
}

func (w *WalletFunding) Settle(delta int) error {
	if delta == 0 {
		return nil
	}
	if delta > 0 {
		return model.DecreaseUserQuota(w.userId, delta, false)
	}
	return model.IncreaseUserQuota(w.userId, -delta, false)
}

func (w *WalletFunding) Refund() error {
	if w.consumed <= 0 {
		return nil
	}
	// IncreaseUserQuota 是 quota += N 的非幂等操作，不能重试，否则会多退额度。
	// 订阅的 RefundSubscriptionPreConsume 有 requestId 幂等保护所以可以重试。
	return model.IncreaseUserQuota(w.userId, w.consumed, false)
}

// ---------------------------------------------------------------------------
// SubscriptionFunding — 订阅资金来源实现
// ---------------------------------------------------------------------------

type SubscriptionFunding struct {
	requestId string
	userId    int
	modelName string
	amount    int64 // 预扣的订阅额度（subConsume）
	// bucket 指定扣哪个额度桶(零值按 premium 处理);量纲随桶:premium=quota,basic=token 数。
	bucket model.SubscriptionBucket
	// targetSubscriptionId > 0 时定向扣该订阅(套餐专用 Key,D9),不遍历其他订阅。
	targetSubscriptionId int
	// relayInfo 供 basic 桶结算取真实 token 总量(SettledTotalTokens);可为 nil。
	relayInfo      *relaycommon.RelayInfo
	subscriptionId int
	preConsumed    int64
	// 以下字段在 PreConsume 成功后填充，供 RelayInfo 同步使用
	AmountTotal     int64
	AmountUsedAfter int64
	PlanId          int
	PlanTitle       string
}

func (s *SubscriptionFunding) Source() string { return BillingSourceSubscription }

// effectiveBucket 归一化桶标识(零值=premium)。
func (s *SubscriptionFunding) effectiveBucket() model.SubscriptionBucket {
	if s.bucket == model.BucketBasic {
		return model.BucketBasic
	}
	return model.BucketPremium
}

func (s *SubscriptionFunding) PreConsume(_ int) error {
	// amount 参数被忽略，使用内部 s.amount（已在构造时根据 preConsumedQuota 计算）
	res, err := model.PreConsumeUserSubscription(s.requestId, s.userId, s.modelName, s.effectiveBucket(), s.amount, s.targetSubscriptionId)
	if err != nil {
		return err
	}
	s.subscriptionId = res.UserSubscriptionId
	s.preConsumed = res.PreConsumed
	s.AmountTotal = res.AmountTotal
	s.AmountUsedAfter = res.AmountUsedAfter
	// 获取订阅计划信息
	if planInfo, err := model.GetSubscriptionPlanInfoByUserSubscriptionId(res.UserSubscriptionId); err == nil && planInfo != nil {
		s.PlanId = planInfo.PlanId
		s.PlanTitle = planInfo.PlanTitle
	}
	return nil
}

func (s *SubscriptionFunding) Settle(delta int) error {
	bucket := s.effectiveBucket()
	if bucket == model.BucketBasic {
		// basic 桶按 token 数结算:补差 = 真实总 token - 预扣估算值。
		// 拿不到真实用量(SettledTotalTokens=0)时不补差,以预扣量为准——
		// 宁可少扣估算误差,不引入错误量纲(quota delta)。
		if s.relayInfo == nil || s.relayInfo.SettledTotalTokens <= 0 {
			return nil
		}
		tokenDelta := int64(s.relayInfo.SettledTotalTokens) - s.preConsumed
		if tokenDelta == 0 {
			return nil
		}
		return model.PostConsumeUserSubscriptionDelta(s.subscriptionId, bucket, tokenDelta)
	}
	if delta == 0 {
		return nil
	}
	return model.PostConsumeUserSubscriptionDelta(s.subscriptionId, bucket, int64(delta))
}

func (s *SubscriptionFunding) Refund() error {
	if s.preConsumed <= 0 {
		return nil
	}
	return refundWithRetry(func() error {
		return model.RefundSubscriptionPreConsume(s.requestId)
	})
}

// refundWithRetry 尝试多次执行退款操作以提高成功率，只能用于基于事务的退款函数！！！！！！
// try to refund with retries, only for refund functions based on transactions!!!
func refundWithRetry(fn func() error) error {
	if fn == nil {
		return nil
	}
	const maxAttempts = 3
	var lastErr error
	for i := 0; i < maxAttempts; i++ {
		if err := fn(); err == nil {
			return nil
		} else {
			lastErr = err
		}
		if i < maxAttempts-1 {
			time.Sleep(time.Duration(200*(i+1)) * time.Millisecond)
		}
	}
	return lastErr
}
