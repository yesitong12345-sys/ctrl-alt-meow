#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""py-fsrs 桥接层。

Node 侧通过 stdin/stdout 的 JSON 调用官方 FSRS 调度器（fsrs 6.x），
避免在 JS 里重复实现 FSRS 数学，保证与 py-fsrs 完全一致。

用法::

    echo '{"op":"review","card":{...},"rating":3}' | python fsrs_bridge.py

支持的操作（op）：
    review          单张卡片评分，返回新卡片状态与间隔
    reviewBatch     批量评分
    retrievability  计算当前可回忆概率 R（用于量化掌握度）
    preview         预览四档评分各自的间隔（前端按钮提示用）

输出始终是一行 JSON：
    {"ok": true, ...}  或  {"ok": false, "error": "...", "errorType": "..."}
"""

import json
import sys
from datetime import datetime, timezone

try:
    from fsrs import Scheduler, Card, Rating
except Exception as exc:  # pragma: no cover - 只在环境缺失时触发
    json.dump({'ok': False, 'error': 'py-fsrs 不可用: %s' % exc, 'errorType': 'ImportError'}, sys.stdout, ensure_ascii=False)
    sys.stdout.write('\n')
    sys.exit(2)

# py-fsrs 的 Card 字典只接受这些字段
CARD_FIELDS = ('card_id', 'state', 'step', 'stability', 'difficulty', 'due', 'last_review')


def parse_dt(value):
    """把 ISO 字符串解析成带时区的 datetime。"""
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip()
    if text.endswith('Z'):
        text = text[:-1] + '+00:00'
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def to_iso(value):
    if not value:
        return None
    return value.astimezone(timezone.utc).isoformat()


def build_scheduler(payload):
    retention = payload.get('desiredRetention')
    try:
        retention = float(retention) if retention is not None else 0.9
    except (TypeError, ValueError):
        retention = 0.9
    retention = min(max(retention, 0.7), 0.99)
    # 错题复习是「当天过一遍」的场景，不能沿用 FSRS 默认的分钟级学习步长
    # （默认下新卡评「还行」只给 10 分钟后，对复习队列毫无意义）。
    # 关掉学习/重学步长后：忘了→1 天、有点难→1 天、还行→2 天、太简单→9 天，
    # 正好对应错题复盘的节奏。
    return Scheduler(desired_retention=retention, learning_steps=[], relearning_steps=[])


def card_from(raw):
    """把外层传入的卡片 JSON 还原成 py-fsrs 的 Card（新卡则返回空 Card）。"""
    if not raw:
        return Card()
    data = {key: raw.get(key) for key in CARD_FIELDS if key in raw}
    # 没有任何复习统计 => 全新卡片
    if data.get('stability') is None and data.get('difficulty') is None:
        card = Card()
        if data.get('card_id') is not None:
            try:
                card.card_id = int(data['card_id'])
            except (TypeError, ValueError):
                pass
        return card
    # 旧版持久化曾保存复习参数但没有 py-fsrs 的内部 card_id。
    # 补齐结构字段，保留已有稳定度、难度和到期时间；评分后会写回完整 Card。
    defaults = Card().to_dict()
    data = {**defaults, **data}
    if isinstance(data['state'], str) and not data['state'].isdigit():
        states = {'learning': 1, 'review': 2, 'relearning': 3}
        data['state'] = states.get(data['state'].lower(), data['state'])
    # 注意：Card.from_dict 内部用 datetime.fromisoformat 解析，
    # 这里必须保持 ISO 字符串，传 datetime 会报 "argument must be str"。
    return Card.from_dict(data)


def card_to_json(card):
    return json.loads(card.to_json())


def safe_retrievability(scheduler, card, now):
    if not card.stability:
        return 0.0
    try:
        return float(scheduler.get_card_retrievability(card, now))
    except Exception:
        return 0.0


def interval_days(card, now):
    return round((card.due - now).total_seconds() / 86400.0, 4)


def do_review(scheduler, raw_card, rating, now):
    card = card_from(raw_card)
    before = safe_retrievability(scheduler, card, now)
    rating_value = int(rating)
    if rating_value < 1 or rating_value > 4:
        raise ValueError('rating 必须是 1~4（忘了/有点难/还行/太简单）')
    new_card, _log = scheduler.review_card(card, Rating(rating_value), review_datetime=now)
    state_name = getattr(new_card.state, 'name', None) or str(new_card.state)
    return {
        'card': card_to_json(new_card),
        'rating': rating_value,
        'intervalDays': interval_days(new_card, now),
        'dueAt': to_iso(new_card.due),
        'stability': new_card.stability,
        'difficulty': new_card.difficulty,
        'state': state_name,
        'retrievabilityBefore': round(before, 6),
        'retrievabilityAfter': round(safe_retrievability(scheduler, new_card, now), 6),
    }


def main():
    raw = sys.stdin.read()
    payload = json.loads(raw) if raw and raw.strip() else {}
    op = payload.get('op') or 'review'
    scheduler = build_scheduler(payload)
    now = parse_dt(payload.get('now')) or datetime.now(timezone.utc)

    if op == 'review':
        result = do_review(scheduler, payload.get('card'), payload.get('rating', 3), now)
    elif op == 'reviewBatch':
        items = []
        for entry in payload.get('items') or []:
            entry_now = parse_dt(entry.get('now')) or now
            items.append(do_review(scheduler, entry.get('card'), entry.get('rating', 3), entry_now))
        result = {'items': items}
    elif op == 'retrievability':
        card = card_from(payload.get('card'))
        result = {
            'retrievability': round(safe_retrievability(scheduler, card, now), 6),
            'stability': card.stability,
            'difficulty': card.difficulty,
            'dueAt': to_iso(card.due),
            'state': getattr(card.state, 'name', None) or str(card.state),
        }
    elif op == 'preview':
        card = card_from(payload.get('card'))
        items = []
        for rating_value in (1, 2, 3, 4):
            preview_card, _log = scheduler.review_card(card, Rating(rating_value), review_datetime=now)
            items.append({
                'rating': rating_value,
                'intervalDays': interval_days(preview_card, now),
                'dueAt': to_iso(preview_card.due),
                'stability': preview_card.stability,
            })
        result = {'items': items}
    else:
        raise ValueError('未知的 op: %s' % op)

    json.dump({'ok': True, **result}, sys.stdout, ensure_ascii=False)
    sys.stdout.write('\n')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        json.dump({'ok': False, 'error': str(exc), 'errorType': type(exc).__name__}, sys.stdout, ensure_ascii=False)
        sys.stdout.write('\n')
        sys.exit(1)
