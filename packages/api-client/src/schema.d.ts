// Generated from packages/contracts/openapi.json by `pnpm contract:generate`. Do not edit.
export type paths = {
    "/api-tokens": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 令牌元信息
         * @description 计划于 M6-SERVER 实现；当前返回 501。
         */
        get: operations["listApiTokens"];
        put?: never;
        /**
         * 签发 PAT（只显示一次）
         * @description 计划于 M6-SERVER 实现；当前返回 501。
         */
        post: operations["createApiToken"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api-tokens/{tokenId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * 撤销令牌，立即生效
         * @description 计划于 M6-SERVER 实现；当前返回 501。
         */
        delete: operations["revokeApiToken"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/exchange-rate-refresh-jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 去重刷新任务（系统管理员） */
        post: operations["createExchangeRateRefreshJob"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/exchange-rate-refresh-jobs/{jobId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 刷新任务状态（系统管理员） */
        get: operations["getExchangeRateRefreshJob"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/exchange-rates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 参考汇率与新鲜度 */
        get: operations["getExchangeRates"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 我可访问的账本 */
        get: operations["listLedgers"];
        put?: never;
        /** 新建账本，创建者成为 owner */
        post: operations["createLedger"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 账本详情 */
        get: operations["getLedger"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** 修改账本名称 */
        patch: operations["updateLedger"];
        trace?: never;
    };
    "/ledgers/{ledgerId}/accounts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 账户列表 */
        get: operations["listAccounts"];
        put?: never;
        /** 新建账户 */
        post: operations["createAccount"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/accounts/{accountId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 账户详情与余额 */
        get: operations["getAccount"];
        put?: never;
        post?: never;
        /** 归档账户（保留历史） */
        delete: operations["archiveAccount"];
        options?: never;
        head?: never;
        /** 修改账户名称 / 备注 */
        patch: operations["updateAccount"];
        trace?: never;
    };
    "/ledgers/{ledgerId}/approval-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 待审批的高影响操作
         * @description 计划于 M6-SERVER 实现；当前返回 501。
         */
        get: operations["listApprovalRequests"];
        put?: never;
        /**
         * Agent 发起审批
         * @description 计划于 M6-SERVER 实现；当前返回 501。
         */
        post: operations["createApprovalRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/approval-requests/{approvalId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 审批状态
         * @description 计划于 M6-SERVER 实现；当前返回 501。
         */
        get: operations["getApprovalRequest"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * 批准 / 拒绝（仅 Web 用户）
         * @description 计划于 M6-SERVER 实现；当前返回 501。
         */
        patch: operations["updateApprovalRequest"];
        trace?: never;
    };
    "/ledgers/{ledgerId}/audit-events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 审计事件（新到旧） */
        get: operations["listAuditEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/bill-occurrences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 账单列表 / 日历
         * @description 计划于 M4-SUBS 实现；当前返回 501。
         */
        get: operations["listBillOccurrences"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/bill-occurrences/{occurrenceId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 账单详情
         * @description 计划于 M4-SUBS 实现；当前返回 501。
         */
        get: operations["getBillOccurrence"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * 跳过 / 恢复账单
         * @description 计划于 M4-SUBS 实现；当前返回 501。
         */
        patch: operations["updateBillOccurrence"];
        trace?: never;
    };
    "/ledgers/{ledgerId}/bill-occurrences/{occurrenceId}/payments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 记录实际支付，唯一关联交易（不是银行扣款）
         * @description 计划于 M4-SUBS 实现；当前返回 501。
         *
         *     业务冲突码：ALREADY_PAID。
         */
        post: operations["createBillPayment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/budgets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 预算 */
        get: operations["listBudgets"];
        put?: never;
        /** 新建预算 */
        post: operations["createBudget"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/budgets/{budgetId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** 归档预算 */
        delete: operations["archiveBudget"];
        options?: never;
        head?: never;
        /** 修改预算 */
        patch: operations["updateBudget"];
        trace?: never;
    };
    "/ledgers/{ledgerId}/categories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 分类 */
        get: operations["listCategories"];
        put?: never;
        /** 新建分类 */
        post: operations["createCategory"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/categories/{categoryId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** 归档分类（已引用的只归档） */
        delete: operations["archiveCategory"];
        options?: never;
        head?: never;
        /** 修改分类 */
        patch: operations["updateCategory"];
        trace?: never;
    };
    "/ledgers/{ledgerId}/export-jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 我创建的导出任务 */
        get: operations["listExportJobs"];
        put?: never;
        /** 创建导出任务 */
        post: operations["createExportJob"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/export-jobs/{exportJobId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 导出状态与短期下载地址 */
        get: operations["getExportJob"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/export-jobs/{exportJobId}/file": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 下载导出文件（仅创建者，1 小时内）
         * @description 业务冲突码：EXPORT_NOT_READY。
         */
        get: operations["downloadExportFile"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/import-jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 导入任务（新到旧） */
        get: operations["listImportJobs"];
        put?: never;
        /** 上传 CSV，异步校验并生成预览 */
        post: operations["createImportJob"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/import-jobs/{importJobId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 导入任务状态与行级错误 */
        get: operations["getImportJob"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/import-jobs/{importJobId}/commits": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 提交已校验批次（异步入账）
         * @description 业务冲突码：IMPORT_NOT_VALIDATED。
         */
        post: operations["createImportCommit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/import-jobs/{importJobId}/reversals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 撤销该批次生成的账务（异步作废）
         * @description 业务冲突码：IMPORT_NOT_COMMITTED。
         */
        post: operations["createImportReversal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/manual-rate-records": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 账本的人工汇率记录（新到旧） */
        get: operations["listManualRateRecords"];
        put?: never;
        /** 有理由的人工汇率 */
        post: operations["createManualRateRecord"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/memberships": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 账本成员 */
        get: operations["listMemberships"];
        put?: never;
        /**
         * 添加已注册成员
         * @description 业务冲突码：MEMBERSHIP_EXISTS。
         */
        post: operations["createMembership"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/memberships/{membershipId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * 移除成员，保护最后 owner
         * @description 业务冲突码：LAST_OWNER。
         */
        delete: operations["deleteMembership"];
        options?: never;
        head?: never;
        /**
         * 修改成员角色，保护最后 owner
         * @description 业务冲突码：LAST_OWNER。
         */
        patch: operations["updateMembership"];
        trace?: never;
    };
    "/ledgers/{ledgerId}/notification-deliveries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 投递记录与平台状态
         * @description 计划于 M5-ENGINE 实现；当前返回 501。
         */
        get: operations["listNotificationDeliveries"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/notification-deliveries/{deliveryId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 投递详情
         * @description 计划于 M5-ENGINE 实现；当前返回 501。
         */
        get: operations["getNotificationDelivery"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 站内通知
         * @description 计划于 M5-OTHER 实现；当前返回 501。
         */
        get: operations["listNotifications"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/notifications/{notificationId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 站内通知详情
         * @description 计划于 M5-OTHER 实现；当前返回 501。
         */
        get: operations["getNotification"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * 标记已读 / 未读
         * @description 计划于 M5-OTHER 实现；当前返回 501。
         */
        patch: operations["updateNotification"];
        trace?: never;
    };
    "/ledgers/{ledgerId}/operations/{operationId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 写入结果 / 异步操作状态（原 actor）
         * @description 计划于 M6-SERVER 实现；当前返回 501。
         */
        get: operations["getOperation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/reminder-previews": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 未来三次提醒时间与免打扰影响
         * @description 计划于 M5-ENGINE 实现；当前返回 501。
         */
        post: operations["createReminderPreview"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/reminder-rules": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 提醒规则
         * @description 计划于 M5-ENGINE 实现；当前返回 501。
         */
        get: operations["listReminderRules"];
        put?: never;
        /**
         * 提交预览创建规则
         * @description 计划于 M5-ENGINE 实现；当前返回 501。
         *
         *     业务冲突码：PREVIEW_STALE。
         */
        post: operations["createReminderRule"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/reminder-rules/{ruleId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * 停用规则并取消未发送任务
         * @description 计划于 M5-ENGINE 实现；当前返回 501。
         */
        delete: operations["deleteReminderRule"];
        options?: never;
        head?: never;
        /**
         * 修改规则
         * @description 计划于 M5-ENGINE 实现；当前返回 501。
         */
        patch: operations["updateReminderRule"];
        trace?: never;
    };
    "/ledgers/{ledgerId}/reports/account-balances": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 账户余额与净资产估值 */
        get: operations["getAccountBalances"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/reports/budget-progress": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 预算进度与阈值 */
        get: operations["getBudgetProgress"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/reports/cash-flow": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 收支趋势 */
        get: operations["getCashFlow"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/reports/category-breakdown": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 分类排行 */
        get: operations["getCategoryBreakdown"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/reports/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** KPI 汇总 */
        get: operations["getReportSummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/subscription-previews": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 校验周期并展示未来三次
         * @description 计划于 M4-SUBS 实现；当前返回 501。
         */
        post: operations["createSubscriptionPreview"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/subscriptions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 周期订阅
         * @description 计划于 M4-SUBS 实现；当前返回 501。
         */
        get: operations["listSubscriptions"];
        put?: never;
        /**
         * 提交预览创建订阅
         * @description 计划于 M4-SUBS 实现；当前返回 501。
         *
         *     业务冲突码：PREVIEW_STALE。
         */
        post: operations["createSubscription"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/subscriptions/{subscriptionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 订阅详情
         * @description 计划于 M4-SUBS 实现；当前返回 501。
         */
        get: operations["getSubscription"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * 修改、暂停、取消（状态字段）
         * @description 计划于 M4-SUBS 实现；当前返回 501。
         */
        patch: operations["updateSubscription"];
        trace?: never;
    };
    "/ledgers/{ledgerId}/tags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 标签 */
        get: operations["listTags"];
        put?: never;
        /**
         * 新建标签
         * @description 业务冲突码：TAG_EXISTS。
         */
        post: operations["createTag"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/tags/{tagId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** 归档标签 */
        delete: operations["archiveTag"];
        options?: never;
        head?: never;
        /**
         * 修改标签
         * @description 业务冲突码：TAG_EXISTS。
         */
        patch: operations["updateTag"];
        trace?: never;
    };
    "/ledgers/{ledgerId}/transaction-previews": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 预览：规范化金额、余额影响、锁定汇率
         * @description 业务冲突码：REFUND_EXCEEDS_PAID。
         */
        post: operations["createTransactionPreview"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/transactions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 明细、筛选与分页 */
        get: operations["listTransactions"];
        put?: never;
        /**
         * 提交预览，新建收支或转账
         * @description 业务冲突码：PREVIEW_CONSUMED / PREVIEW_STALE。
         */
        post: operations["createTransaction"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledgerId}/transactions/{transactionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 交易详情 */
        get: operations["getTransaction"];
        put?: never;
        post?: never;
        /**
         * 作废：创建反向 posting，重复作废无影响
         * @description 业务冲突码：HAS_REFUNDS。
         */
        delete: operations["voidTransaction"];
        options?: never;
        head?: never;
        /**
         * 更正：同事务冲正并生成新版本
         * @description 业务冲突码：PREVIEW_CONSUMED / PREVIEW_STALE / HAS_REFUNDS / TRANSACTION_VOIDED。
         */
        patch: operations["updateTransaction"];
        trace?: never;
    };
    "/ledgers/{ledgerId}/transactions/{transactionId}/refunds": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 关联退款，累计不超过原支付
         * @description 业务冲突码：REFUND_EXCEEDS_PAID / PREVIEW_CONSUMED / PREVIEW_STALE。
         */
        post: operations["createRefund"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 当前身份、账本列表与有效作用域 */
        get: operations["getMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/preferences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 外观偏好
         * @description 计划于 M4-THEME 实现；当前返回 501。
         */
        get: operations["getPreferences"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * 修改外观偏好
         * @description 计划于 M4-THEME 实现；当前返回 501。
         */
        patch: operations["updatePreferences"];
        trace?: never;
    };
    "/notification-channels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 我的通知渠道
         * @description 计划于 M5-ENGINE 实现；当前返回 501。
         */
        get: operations["listNotificationChannels"];
        put?: never;
        /**
         * 配置渠道（凭据加密保存）
         * @description 计划于 M5-ENGINE 实现；当前返回 501。
         */
        post: operations["createNotificationChannel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notification-channels/{channelId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * 删除渠道配置
         * @description 计划于 M5-ENGINE 实现；当前返回 501。
         */
        delete: operations["deleteNotificationChannel"];
        options?: never;
        head?: never;
        /**
         * 修改 / 停用渠道
         * @description 计划于 M5-ENGINE 实现；当前返回 501。
         */
        patch: operations["updateNotificationChannel"];
        trace?: never;
    };
    "/notification-channels/{channelId}/test-deliveries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 创建测试投递
         * @description 计划于 M5-ENGINE 实现；当前返回 501。
         */
        post: operations["createTestDelivery"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
};
export type webhooks = Record<string, never>;
export type components = {
    schemas: {
        Account: {
            archivedAt: string | null;
            balance: components["schemas"]["Decimal"];
            currency: components["schemas"]["Currency"];
            /** Format: uuid */
            id: string;
            name: string;
            note: string | null;
            openingBalance: components["schemas"]["Decimal"];
            type: components["schemas"]["AccountType"];
            version: number;
        };
        AccountBalances: {
            /**
             * Format: date-time
             * @description RFC 3339 UTC 时间
             */
            asOf: string;
            currency: components["schemas"]["Currency"];
            dataVersion: number;
            /** @description 因缺汇率被排除的交易数 */
            excludedCount: number;
            items: {
                /** Format: uuid */
                accountId: string;
                balance: components["schemas"]["Decimal"];
                currency: components["schemas"]["Currency"];
                freshness: components["schemas"]["Freshness"];
                name: string;
                valuation: components["schemas"]["Decimal"] | null;
            }[];
            partial: boolean;
            sourceAt: string | null;
            total: components["schemas"]["Decimal"];
            /**
             * @description historical 使用入账时 base_amount；current 按 asOf 参考汇率估值
             * @enum {string}
             */
            valuationMode: "historical" | "current";
        };
        AccountBalancesList: {
            data: components["schemas"]["AccountBalances"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        AccountBalancesResponse: {
            data: components["schemas"]["AccountBalances"];
            meta: components["schemas"]["Meta"];
        };
        AccountCreate: {
            currency: components["schemas"]["Currency"];
            name: string;
            note?: string;
            /** @default 0 */
            openingBalance: components["schemas"]["Decimal"];
            type: components["schemas"]["AccountType"];
        };
        AccountList: {
            data: components["schemas"]["Account"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        AccountResponse: {
            data: components["schemas"]["Account"];
            meta: components["schemas"]["Meta"];
        };
        /** @enum {string} */
        AccountType: "cash" | "bank" | "credit_card" | "e_wallet" | "investment" | "other";
        AccountUpdate: {
            name?: string;
            note?: string | null;
        };
        ApiToken: {
            /**
             * Format: date-time
             * @description RFC 3339 UTC 时间
             */
            createdAt: string;
            /**
             * Format: date-time
             * @description RFC 3339 UTC 时间
             */
            expiresAt: string;
            /** Format: uuid */
            id: string;
            lastUsedAt: string | null;
            ledgerIds: string[];
            name: string;
            /** @description 用于辨认的前缀，非完整令牌 */
            prefix: string;
            revokedAt: string | null;
            scopes: components["schemas"]["Scope"][];
        };
        ApiTokenCreate: {
            expiresInDays: number;
            ledgerIds: string[];
            name: string;
            scopes: components["schemas"]["Scope"][];
        };
        ApiTokenCreatedResponse: {
            data: {
                /**
                 * Format: date-time
                 * @description RFC 3339 UTC 时间
                 */
                createdAt: string;
                /**
                 * Format: date-time
                 * @description RFC 3339 UTC 时间
                 */
                expiresAt: string;
                /** Format: uuid */
                id: string;
                lastUsedAt: string | null;
                ledgerIds: string[];
                name: string;
                /** @description 用于辨认的前缀，非完整令牌 */
                prefix: string;
                revokedAt: string | null;
                scopes: components["schemas"]["Scope"][];
                /** @description 只在本次响应中出现一次 */
                token: string;
            };
            meta: {
                /** Format: uuid */
                requestId: string;
            };
        };
        ApiTokenList: {
            data: components["schemas"]["ApiToken"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        ApiTokenResponse: {
            data: components["schemas"]["ApiToken"];
            meta: components["schemas"]["Meta"];
        };
        AppliedRate: {
            base: components["schemas"]["Currency"];
            freshness: components["schemas"]["Freshness"];
            manualReason: string | null;
            quote: components["schemas"]["Currency"];
            source: string;
            sourceAt: string | null;
            value: components["schemas"]["Rate"];
        };
        ApprovalRequest: {
            approvalUrl: string;
            /**
             * Format: date-time
             * @description RFC 3339 UTC 时间
             */
            createdAt: string;
            decidedAt: string | null;
            decidedBy: string | null;
            /**
             * Format: date-time
             * @description RFC 3339 UTC 时间
             */
            expiresAt: string;
            /** Format: uuid */
            id: string;
            operation: {
                bodyHash: string;
                /** @enum {string} */
                method: "POST" | "PATCH" | "DELETE";
                path: string;
            };
            reason: string | null;
            requestedBy: {
                /** Format: uuid */
                id: string;
                name: string;
                /** @enum {string} */
                via: "session" | "token";
            };
            /** @enum {string} */
            status: "pending" | "approved" | "rejected" | "expired" | "consumed";
            summary: string;
            version: number;
        };
        ApprovalRequestCreate: {
            body: {
                [key: string]: unknown;
            } | null;
            /** @enum {string} */
            method: "POST" | "PATCH" | "DELETE";
            path: string;
            reason?: string;
            summary: string;
        };
        ApprovalRequestList: {
            data: components["schemas"]["ApprovalRequest"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        ApprovalRequestResponse: {
            data: components["schemas"]["ApprovalRequest"];
            meta: components["schemas"]["Meta"];
        };
        ApprovalRequestUpdate: {
            /** @enum {string} */
            decision: "approved" | "rejected";
            note?: string;
        };
        AuditEvent: {
            action: string;
            actor: {
                /** Format: uuid */
                id: string;
                name: string;
            };
            /**
             * Format: date-time
             * @description RFC 3339 UTC 时间
             */
            createdAt: string;
            /** Format: uuid */
            id: string;
            requestId: string;
            /** Format: uuid */
            resourceId: string;
        };
        AuditEventList: {
            data: components["schemas"]["AuditEvent"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        AuditEventResponse: {
            data: components["schemas"]["AuditEvent"];
            meta: components["schemas"]["Meta"];
        };
        BillOccurrence: {
            amount: components["schemas"]["Money"];
            /** Format: uuid */
            id: string;
            /**
             * Format: date
             * @description 业务日期 YYYY-MM-DD，按账本 / 订阅时区解释
             */
            scheduledDate: string;
            scheduleVersion: number;
            status: components["schemas"]["BillStatus"];
            /** Format: uuid */
            subscriptionId: string;
            transactionId: string | null;
            version: number;
        };
        BillOccurrenceList: {
            data: components["schemas"]["BillOccurrence"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        BillOccurrenceResponse: {
            data: components["schemas"]["BillOccurrence"];
            meta: components["schemas"]["Meta"];
        };
        BillOccurrenceUpdate: {
            /** @enum {string} */
            status: "skipped" | "scheduled";
        };
        BillPayment: {
            occurrence: components["schemas"]["BillOccurrence"];
            transaction: components["schemas"]["Transaction"];
        };
        BillPaymentCreate: {
            /** Format: uuid */
            previewId: string;
        } | {
            /** Format: uuid */
            transactionId: string;
        };
        BillPaymentList: {
            data: components["schemas"]["BillPayment"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        BillPaymentResponse: {
            data: components["schemas"]["BillPayment"];
            meta: components["schemas"]["Meta"];
        };
        /** @enum {string} */
        BillStatus: "scheduled" | "due" | "paid" | "skipped" | "overdue";
        Budget: {
            alertThresholds: number[];
            amount: components["schemas"]["Money"];
            archivedAt: string | null;
            /** @description null 表示总预算 */
            categoryId: string | null;
            /** Format: uuid */
            id: string;
            name: string | null;
            /** @enum {string} */
            period: "week" | "month" | "year";
            /**
             * Format: date
             * @description 业务日期 YYYY-MM-DD，按账本 / 订阅时区解释
             */
            startDate: string;
            version: number;
        };
        BudgetCreate: {
            /**
             * @default [
             *       80,
             *       100
             *     ]
             */
            alertThresholds: number[];
            amount: components["schemas"]["Money"];
            /** Format: uuid */
            categoryId?: string;
            name?: string;
            /** @enum {string} */
            period: "week" | "month" | "year";
            /**
             * Format: date
             * @description 业务日期 YYYY-MM-DD，按账本 / 订阅时区解释
             */
            startDate: string;
        };
        BudgetList: {
            data: components["schemas"]["Budget"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        BudgetProgress: {
            currency: components["schemas"]["Currency"];
            dataVersion: number;
            /**
             * Format: date
             * @description 业务日期 YYYY-MM-DD，按账本 / 订阅时区解释
             */
            date: string;
            /** @description 因缺汇率被排除的交易数 */
            excludedCount: number;
            items: {
                amount: components["schemas"]["Money"];
                /** Format: uuid */
                budgetId: string;
                categoryId: string | null;
                name: string | null;
                /** @enum {string} */
                period: "week" | "month" | "year";
                /**
                 * Format: date
                 * @description 不含当日
                 */
                periodEnd: string;
                /**
                 * Format: date
                 * @description 业务日期 YYYY-MM-DD，按账本 / 订阅时区解释
                 */
                periodStart: string;
                /** @description 已用比例（小数，4 位） */
                ratio: string;
                reachedThresholds: number[];
                remaining: components["schemas"]["Decimal"];
                spent: components["schemas"]["Decimal"];
            }[];
            partial: boolean;
            sourceAt: string | null;
            /**
             * @description historical 使用入账时 base_amount；current 按 asOf 参考汇率估值
             * @enum {string}
             */
            valuationMode: "historical" | "current";
        };
        BudgetProgressList: {
            data: components["schemas"]["BudgetProgress"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        BudgetProgressResponse: {
            data: components["schemas"]["BudgetProgress"];
            meta: components["schemas"]["Meta"];
        };
        BudgetResponse: {
            data: components["schemas"]["Budget"];
            meta: components["schemas"]["Meta"];
        };
        BudgetUpdate: {
            alertThresholds?: number[];
            amount?: components["schemas"]["Money"];
            name?: string | null;
        };
        CashFlow: {
            currency: components["schemas"]["Currency"];
            dataVersion: number;
            /** @description 因缺汇率被排除的交易数 */
            excludedCount: number;
            /** @enum {string} */
            interval: "day" | "week" | "month";
            partial: boolean;
            points: {
                /**
                 * Format: date
                 * @description 业务日期 YYYY-MM-DD，按账本 / 订阅时区解释
                 */
                date: string;
                expense: components["schemas"]["Decimal"];
                income: components["schemas"]["Decimal"];
                net: components["schemas"]["Decimal"];
            }[];
            sourceAt: string | null;
            /**
             * @description historical 使用入账时 base_amount；current 按 asOf 参考汇率估值
             * @enum {string}
             */
            valuationMode: "historical" | "current";
        };
        CashFlowList: {
            data: components["schemas"]["CashFlow"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        CashFlowResponse: {
            data: components["schemas"]["CashFlow"];
            meta: components["schemas"]["Meta"];
        };
        Category: {
            archivedAt: string | null;
            icon: string | null;
            /** Format: uuid */
            id: string;
            kind: components["schemas"]["CategoryKind"];
            name: string;
            parentId: string | null;
            version: number;
        };
        CategoryBreakdown: {
            currency: components["schemas"]["Currency"];
            dataVersion: number;
            /** @description 因缺汇率被排除的交易数 */
            excludedCount: number;
            items: {
                amount: components["schemas"]["Decimal"];
                categoryId: string | null;
                count: number;
                name: string;
                share: components["schemas"]["Decimal"];
            }[];
            /** @enum {string} */
            kind: "expense" | "income";
            partial: boolean;
            sourceAt: string | null;
            total: components["schemas"]["Decimal"];
            /**
             * @description historical 使用入账时 base_amount；current 按 asOf 参考汇率估值
             * @enum {string}
             */
            valuationMode: "historical" | "current";
        };
        CategoryBreakdownList: {
            data: components["schemas"]["CategoryBreakdown"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        CategoryBreakdownResponse: {
            data: components["schemas"]["CategoryBreakdown"];
            meta: components["schemas"]["Meta"];
        };
        CategoryCreate: {
            icon?: string;
            kind: components["schemas"]["CategoryKind"];
            name: string;
            /** Format: uuid */
            parentId?: string;
        };
        /** @enum {string} */
        CategoryKind: "expense" | "income";
        CategoryList: {
            data: components["schemas"]["Category"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        CategoryResponse: {
            data: components["schemas"]["Category"];
            meta: components["schemas"]["Meta"];
        };
        CategoryUpdate: {
            icon?: string | null;
            name?: string;
            parentId?: string | null;
        };
        /** @enum {string} */
        ChannelType: "telegram" | "feishu" | "wecom_bot" | "wecom_app" | "pushplus_wechat" | "email" | "webhook" | "in_app";
        /** @enum {string} */
        Currency: "CNY" | "USD" | "HKD" | "EUR" | "JPY";
        Cycle: {
            count: number;
            /** @enum {string} */
            unit: "day" | "week" | "month" | "year";
        };
        Decimal: string;
        /** @enum {string} */
        DeliveryStatus: "queued" | "sending" | "accepted" | "delivered" | "failed" | "delivery_unknown" | "expired" | "cancelled";
        ExchangeRateRefreshJob: {
            completedAt: string | null;
            /**
             * Format: date-time
             * @description RFC 3339 UTC 时间
             */
            createdAt: string;
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            status: "queued" | "running" | "succeeded" | "failed";
        };
        ExchangeRateRefreshJobCreate: {
            reason?: string;
        };
        ExchangeRateRefreshJobList: {
            data: components["schemas"]["ExchangeRateRefreshJob"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        ExchangeRateRefreshJobResponse: {
            data: components["schemas"]["ExchangeRateRefreshJob"];
            meta: components["schemas"]["Meta"];
        };
        ExchangeRates: {
            /**
             * Format: date-time
             * @description RFC 3339 UTC 时间
             */
            asOf: string;
            base: components["schemas"]["Currency"];
            rates: {
                fetchedAt: string | null;
                freshness: components["schemas"]["Freshness"];
                quote: components["schemas"]["Currency"];
                source: string | null;
                sourceAt: string | null;
                value: components["schemas"]["Rate"] | null;
            }[];
        };
        ExchangeRatesList: {
            data: components["schemas"]["ExchangeRates"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        ExchangeRatesResponse: {
            data: components["schemas"]["ExchangeRates"];
            meta: components["schemas"]["Meta"];
        };
        ExportJob: {
            /**
             * Format: date-time
             * @description RFC 3339 UTC 时间
             */
            createdAt: string;
            /** @description 短期有效、需同一用户鉴权的下载地址 */
            downloadUrl: string | null;
            expiresAt: string | null;
            /** @constant */
            format: "csv";
            /** Format: uuid */
            id: string;
            rowCount: number | null;
            /** @enum {string} */
            status: "queued" | "running" | "ready" | "failed" | "expired";
        };
        ExportJobCreate: {
            /** Format: uuid */
            accountId?: string;
            /** Format: uuid */
            categoryId?: string;
            /**
             * Format: date
             * @description 业务日期 YYYY-MM-DD，按账本 / 订阅时区解释
             */
            dateFrom?: string;
            /**
             * Format: date
             * @description 业务日期 YYYY-MM-DD，按账本 / 订阅时区解释
             */
            dateTo?: string;
            /** @constant */
            format: "csv";
        };
        ExportJobList: {
            data: components["schemas"]["ExportJob"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        ExportJobResponse: {
            data: components["schemas"]["ExportJob"];
            meta: components["schemas"]["Meta"];
        };
        /** @enum {string} */
        Freshness: "fresh" | "delayed" | "stale" | "market_closed" | "missing" | "manual";
        ImportJob: {
            committedAt: string | null;
            committedRows: number;
            /**
             * Format: date-time
             * @description RFC 3339 UTC 时间
             */
            createdAt: string;
            /** @description 已在之前批次入账而跳过的行（包含在 errorRows 中） */
            duplicateRows: number;
            errorRows: number;
            /** @description 最多返回前 100 条行级错误，带行号 */
            errors: {
                code: string;
                column: string | null;
                message: string;
                row: number;
            }[];
            failureReason: string | null;
            fileName: string;
            fileSha256: string;
            /** Format: uuid */
            id: string;
            revertedAt: string | null;
            revertedRows: number;
            rowCount: number;
            /** @enum {string} */
            status: "validating" | "validated" | "committing" | "committed" | "failed" | "reverting" | "reverted";
            validRows: number;
        };
        ImportJobCreate: {
            /**
             * Format: binary
             * @description UTF-8 CSV（可带 BOM），最大 5 MB、10,000 行
             */
            file: string;
            /** @description ImportMapping 的 JSON 字符串 */
            mapping: string;
        };
        ImportJobList: {
            data: components["schemas"]["ImportJob"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        ImportJobResponse: {
            data: components["schemas"]["ImportJob"];
            meta: components["schemas"]["Meta"];
        };
        ImportMapping: {
            /** @description CSV 表头名 → 字段。account / category 按名称匹配；currency 须与账户币种一致 */
            columns: {
                account: string;
                amount: string;
                category?: string;
                currency?: string;
                date: string;
                kind?: string;
                merchant?: string;
                note?: string;
            };
            /**
             * @description 默认 YYYY-MM-DD
             * @enum {string}
             */
            dateFormat?: "YYYY-MM-DD" | "YYYY/MM/DD" | "DD/MM/YYYY" | "MM/DD/YYYY";
            /**
             * @description 无类型列时：设置后所有行按此类型且金额须为正；不设置则负数为支出、正数为收入
             * @enum {string}
             */
            defaultKind?: "expense" | "income";
            /** @description 业务日期所在时区，默认账本时区 */
            timezone?: string;
        };
        Ledger: {
            baseCurrency: components["schemas"]["Currency"];
            /** Format: uuid */
            id: string;
            name: string;
            role: components["schemas"]["Role"];
            timezone: string;
            version: number;
        };
        LedgerCreate: {
            baseCurrency: components["schemas"]["Currency"];
            name: string;
            /** @description IANA 时区名 */
            timezone: string;
        };
        LedgerList: {
            data: components["schemas"]["Ledger"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        LedgerResponse: {
            data: components["schemas"]["Ledger"];
            meta: components["schemas"]["Meta"];
        };
        LedgerUpdate: {
            name: string;
        };
        ManualRateRecord: {
            base: components["schemas"]["Currency"];
            /**
             * Format: date-time
             * @description RFC 3339 UTC 时间
             */
            createdAt: string;
            /** Format: uuid */
            createdBy: string;
            /**
             * Format: date
             * @description 业务日期 YYYY-MM-DD，按账本 / 订阅时区解释
             */
            effectiveDate: string;
            /** Format: uuid */
            id: string;
            quote: components["schemas"]["Currency"];
            reason: string;
            value: components["schemas"]["Rate"];
        };
        ManualRateRecordCreate: {
            base: components["schemas"]["Currency"];
            /**
             * Format: date
             * @description 业务日期 YYYY-MM-DD，按账本 / 订阅时区解释
             */
            effectiveDate: string;
            quote: components["schemas"]["Currency"];
            reason: string;
            value: components["schemas"]["Rate"];
        };
        ManualRateRecordList: {
            data: components["schemas"]["ManualRateRecord"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        ManualRateRecordResponse: {
            data: components["schemas"]["ManualRateRecord"];
            meta: components["schemas"]["Meta"];
        };
        Me: {
            auth: {
                scopes: components["schemas"]["Scope"][];
                /** @enum {string} */
                type: "session" | "token";
            };
            defaultLedgerId: string | null;
            /** Format: email */
            email: string;
            /** Format: uuid */
            id: string;
            ledgers: components["schemas"]["Ledger"][];
            name: string;
        };
        MeList: {
            data: components["schemas"]["Me"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        Membership: {
            /** Format: email */
            email: string;
            /** Format: uuid */
            id: string;
            name: string;
            role: components["schemas"]["Role"];
            /** Format: uuid */
            userId: string;
            version: number;
        };
        MembershipCreate: {
            /** Format: email */
            email: string;
            role: components["schemas"]["Role"];
        };
        MembershipList: {
            data: components["schemas"]["Membership"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        MembershipResponse: {
            data: components["schemas"]["Membership"];
            meta: components["schemas"]["Meta"];
        };
        MembershipUpdate: {
            role: components["schemas"]["Role"];
        };
        MeResponse: {
            data: components["schemas"]["Me"];
            meta: components["schemas"]["Meta"];
        };
        Meta: {
            /** Format: uuid */
            requestId: string;
        };
        Money: {
            amount: components["schemas"]["Decimal"];
            currency: components["schemas"]["Currency"];
        };
        Notification: {
            body: string;
            /**
             * Format: date-time
             * @description RFC 3339 UTC 时间
             */
            createdAt: string;
            eventType: components["schemas"]["ReminderEvent"];
            /** Format: uuid */
            id: string;
            link: string | null;
            readAt: string | null;
            title: string;
            version: number;
        };
        NotificationChannel: {
            /** @description 脱敏摘要；永不返回明文凭据 */
            configSummary: {
                [key: string]: string;
            };
            enabled: boolean;
            /** Format: uuid */
            id: string;
            lastVerifiedAt: string | null;
            name: string;
            /** @enum {string} */
            status: "unconfigured" | "verifying" | "active" | "degraded" | "disabled";
            type: components["schemas"]["ChannelType"];
            version: number;
        };
        NotificationChannelCreate: {
            config: {
                /** @description Bot token */
                botToken: string;
                chatId: string;
                /** @constant */
                type: "telegram";
            } | {
                /** @description 签名校验密钥 */
                signingSecret?: string;
                /** @constant */
                type: "feishu";
                /** Format: uri */
                webhookUrl: string;
            } | {
                /** @constant */
                type: "wecom_bot";
                /** Format: uri */
                webhookUrl: string;
            } | {
                agentId: string;
                corpId: string;
                /** @description 应用 Secret */
                secret: string;
                toUser: string;
                /** @constant */
                type: "wecom_app";
            } | {
                /** @description pushplus 消息 token */
                token: string;
                /** @constant */
                type: "pushplus_wechat";
            } | {
                /** Format: email */
                address: string;
                /** @constant */
                type: "email";
            } | {
                /** @description HMAC 签名密钥 */
                secret?: string;
                /** @constant */
                type: "webhook";
                /**
                 * Format: uri
                 * @description 仅 HTTPS；拒绝内网 / metadata 地址
                 */
                url: string;
            } | {
                /** @constant */
                type: "in_app";
            };
            name: string;
        };
        NotificationChannelList: {
            data: components["schemas"]["NotificationChannel"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        NotificationChannelResponse: {
            data: components["schemas"]["NotificationChannel"];
            meta: components["schemas"]["Meta"];
        };
        NotificationChannelUpdate: {
            config?: {
                /** @description Bot token */
                botToken: string;
                chatId: string;
                /** @constant */
                type: "telegram";
            } | {
                /** @description 签名校验密钥 */
                signingSecret?: string;
                /** @constant */
                type: "feishu";
                /** Format: uri */
                webhookUrl: string;
            } | {
                /** @constant */
                type: "wecom_bot";
                /** Format: uri */
                webhookUrl: string;
            } | {
                agentId: string;
                corpId: string;
                /** @description 应用 Secret */
                secret: string;
                toUser: string;
                /** @constant */
                type: "wecom_app";
            } | {
                /** @description pushplus 消息 token */
                token: string;
                /** @constant */
                type: "pushplus_wechat";
            } | {
                /** Format: email */
                address: string;
                /** @constant */
                type: "email";
            } | {
                /** @description HMAC 签名密钥 */
                secret?: string;
                /** @constant */
                type: "webhook";
                /**
                 * Format: uri
                 * @description 仅 HTTPS；拒绝内网 / metadata 地址
                 */
                url: string;
            } | {
                /** @constant */
                type: "in_app";
            };
            enabled?: boolean;
            name?: string;
        };
        NotificationDelivery: {
            attempts: number;
            /** Format: uuid */
            channelId: string;
            channelType: components["schemas"]["ChannelType"];
            /**
             * Format: date-time
             * @description RFC 3339 UTC 时间
             */
            createdAt: string;
            eventId: string;
            eventType: components["schemas"]["ReminderEvent"] | "test";
            /** Format: uuid */
            id: string;
            lastAttemptAt: string | null;
            responseClass: ("ok" | "rate_limited" | "server_error" | "client_error" | "credential_error" | "timeout" | "network") | null;
            /**
             * Format: date-time
             * @description RFC 3339 UTC 时间
             */
            scheduledAt: string;
            status: components["schemas"]["DeliveryStatus"];
        };
        NotificationDeliveryList: {
            data: components["schemas"]["NotificationDelivery"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        NotificationDeliveryResponse: {
            data: components["schemas"]["NotificationDelivery"];
            meta: components["schemas"]["Meta"];
        };
        NotificationList: {
            data: components["schemas"]["Notification"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        NotificationResponse: {
            data: components["schemas"]["Notification"];
            meta: components["schemas"]["Meta"];
        };
        NotificationUpdate: {
            read: boolean;
        };
        Operation: {
            completedAt: string | null;
            /**
             * Format: date-time
             * @description RFC 3339 UTC 时间
             */
            createdAt: string;
            error: components["schemas"]["Problem"] | null;
            /** Format: uuid */
            id: string;
            resource: {
                /** Format: uuid */
                id: string;
                type: string;
                url: string;
            } | null;
            /** @enum {string} */
            status: "pending" | "running" | "succeeded" | "failed";
            type: string;
        };
        OperationList: {
            data: components["schemas"]["Operation"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        OperationResponse: {
            data: components["schemas"]["Operation"];
            meta: components["schemas"]["Meta"];
        };
        Page: {
            hasMore: boolean;
            nextCursor: string | null;
        };
        Preferences: {
            appearance: {
                accent: {
                    /** @constant */
                    type: "preset";
                    /** @enum {string} */
                    value: "teal" | "ocean" | "indigo" | "violet" | "rose" | "forest" | "graphite";
                } | {
                    /** @constant */
                    type: "custom";
                    value: string;
                };
                palette: {
                    dark: {
                        accent: string;
                        adjusted: boolean;
                        minContrast: string;
                        onAccent: string;
                    };
                    light: {
                        accent: string;
                        adjusted: boolean;
                        minContrast: string;
                        onAccent: string;
                    };
                    version: number;
                };
                /** @enum {string} */
                themeMode: "system" | "light" | "dark";
            };
            version: number;
        };
        PreferencesList: {
            data: components["schemas"]["Preferences"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        PreferencesResponse: {
            data: components["schemas"]["Preferences"];
            meta: components["schemas"]["Meta"];
        };
        PreferencesUpdate: {
            appearance: {
                accent?: {
                    /** @constant */
                    type: "preset";
                    /** @enum {string} */
                    value: "teal" | "ocean" | "indigo" | "violet" | "rose" | "forest" | "graphite";
                } | {
                    /** @constant */
                    type: "custom";
                    value: string;
                };
                /** @enum {string} */
                themeMode?: "system" | "light" | "dark";
            };
        };
        PreviewSubmit: {
            /** Format: uuid */
            previewId: string;
        };
        Problem: {
            code: string;
            detail?: string;
            errors?: {
                code?: string;
                message: string;
                path: string;
            }[];
            requestId: string;
            status: number;
            title: string;
            type: string;
        };
        Rate: string;
        /** @enum {string} */
        ReminderEvent: "bill_due" | "trial_end" | "cancel_deadline" | "overdue" | "budget_threshold" | "daily_entry" | "weekly_summary" | "monthly_summary" | "fx_threshold" | "delivery_failed";
        ReminderPreview: {
            /**
             * Format: date-time
             * @description RFC 3339 UTC 时间
             */
            expiresAt: string;
            nextFireTimes: {
                deferredByQuietHours: boolean;
                /**
                 * Format: date
                 * @description 业务日期 YYYY-MM-DD，按账本 / 订阅时区解释
                 */
                localDate: string;
                localTime: string;
                /**
                 * Format: date-time
                 * @description RFC 3339 UTC 时间
                 */
                scheduledAt: string;
            }[];
            /** Format: uuid */
            previewId: string;
            warnings: {
                code: string;
                message: string;
            }[];
        };
        ReminderPreviewCreate: {
            /** Format: uuid */
            budgetId?: string;
            channelIds: string[];
            eventType: components["schemas"]["ReminderEvent"];
            /** @description 到期前天数，例如 [7,3,1,0] */
            leadDays?: number[];
            /** @description 本地时间 HH:mm */
            localTime: string;
            quietHours?: {
                /** @description 本地时间 HH:mm */
                end: string;
                /** @description 本地时间 HH:mm */
                start: string;
            };
            /** Format: uuid */
            subscriptionId?: string;
            /** @description IANA 时区名 */
            timezone: string;
        };
        ReminderPreviewList: {
            data: components["schemas"]["ReminderPreview"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        ReminderPreviewResponse: {
            data: components["schemas"]["ReminderPreview"];
            meta: components["schemas"]["Meta"];
        };
        ReminderRule: {
            budgetId: string | null;
            channelIds: string[];
            enabled: boolean;
            eventType: components["schemas"]["ReminderEvent"];
            /** Format: uuid */
            id: string;
            leadDays: number[];
            localTime: string;
            quietHours: {
                end: string;
                start: string;
            } | null;
            subscriptionId: string | null;
            templateVersion: number;
            timezone: string;
            version: number;
        };
        ReminderRuleList: {
            data: components["schemas"]["ReminderRule"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        ReminderRuleResponse: {
            data: components["schemas"]["ReminderRule"];
            meta: components["schemas"]["Meta"];
        };
        ReminderRuleUpdate: {
            channelIds?: string[];
            enabled?: boolean;
            /** @description 到期前天数，例如 [7,3,1,0] */
            leadDays?: number[];
            /** @description 本地时间 HH:mm */
            localTime?: string;
            quietHours?: {
                /** @description 本地时间 HH:mm */
                end: string;
                /** @description 本地时间 HH:mm */
                start: string;
            } | null;
        };
        ReportSummary: {
            currency: components["schemas"]["Currency"];
            dataVersion: number;
            /** @description 因缺汇率被排除的交易数 */
            excludedCount: number;
            expense: components["schemas"]["Decimal"];
            income: components["schemas"]["Decimal"];
            net: components["schemas"]["Decimal"];
            partial: boolean;
            period: {
                /**
                 * Format: date
                 * @description 业务日期 YYYY-MM-DD，按账本 / 订阅时区解释
                 */
                dateFrom: string;
                /**
                 * Format: date
                 * @description 业务日期 YYYY-MM-DD，按账本 / 订阅时区解释
                 */
                dateTo: string;
                timezone: string;
            };
            refunds: components["schemas"]["Decimal"];
            sourceAt: string | null;
            upcomingBills: {
                amount: components["schemas"]["Decimal"];
                count: number;
            };
            /**
             * @description historical 使用入账时 base_amount；current 按 asOf 参考汇率估值
             * @enum {string}
             */
            valuationMode: "historical" | "current";
        };
        ReportSummaryList: {
            data: components["schemas"]["ReportSummary"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        ReportSummaryResponse: {
            data: components["schemas"]["ReportSummary"];
            meta: components["schemas"]["Meta"];
        };
        /** @enum {string} */
        Role: "owner" | "editor" | "viewer";
        /** @enum {string} */
        Scope: "ledgers:read" | "accounts:read" | "accounts:write" | "categories:read" | "categories:write" | "transactions:read" | "transactions:write" | "subscriptions:read" | "subscriptions:write" | "budgets:read" | "budgets:write" | "reports:read" | "fx:read" | "fx:write" | "reminders:read" | "reminders:write" | "notifications:read" | "notifications:write" | "exports:read" | "approvals:write";
        Subscription: {
            accountId: string | null;
            amount: components["schemas"]["Money"];
            /**
             * Format: date
             * @description 业务日期 YYYY-MM-DD，按账本 / 订阅时区解释
             */
            anchorDate: string;
            categoryId: string | null;
            /**
             * Format: date-time
             * @description RFC 3339 UTC 时间
             */
            createdAt: string;
            cycle: components["schemas"]["Cycle"];
            /** Format: uuid */
            id: string;
            name: string;
            nextDueDate: string | null;
            note: string | null;
            scheduleVersion: number;
            status: components["schemas"]["SubscriptionStatus"];
            timezone: string;
            version: number;
        };
        SubscriptionList: {
            data: components["schemas"]["Subscription"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        SubscriptionPreview: {
            /**
             * Format: date-time
             * @description RFC 3339 UTC 时间
             */
            expiresAt: string;
            /** @description 预测指标，不计入当月实际支出 */
            monthlyEquivalent: components["schemas"]["Money"];
            nextOccurrences: string[];
            /** Format: uuid */
            previewId: string;
            warnings: {
                code: string;
                message: string;
            }[];
        };
        SubscriptionPreviewCreate: {
            /** Format: uuid */
            accountId?: string;
            amount: components["schemas"]["Money"];
            /**
             * Format: date
             * @description 业务日期 YYYY-MM-DD，按账本 / 订阅时区解释
             */
            anchorDate: string;
            /** Format: uuid */
            categoryId?: string;
            cycle: components["schemas"]["Cycle"];
            name: string;
            note?: string;
            /** @description IANA 时区名 */
            timezone: string;
        };
        SubscriptionPreviewList: {
            data: components["schemas"]["SubscriptionPreview"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        SubscriptionPreviewResponse: {
            data: components["schemas"]["SubscriptionPreview"];
            meta: components["schemas"]["Meta"];
        };
        SubscriptionResponse: {
            data: components["schemas"]["Subscription"];
            meta: components["schemas"]["Meta"];
        };
        /** @enum {string} */
        SubscriptionStatus: "active" | "paused" | "cancelled";
        SubscriptionUpdate: {
            accountId?: string | null;
            amount?: components["schemas"]["Money"];
            /**
             * Format: date
             * @description 业务日期 YYYY-MM-DD，按账本 / 订阅时区解释
             */
            anchorDate?: string;
            categoryId?: string | null;
            cycle?: components["schemas"]["Cycle"];
            name?: string;
            note?: string | null;
            status?: components["schemas"]["SubscriptionStatus"];
        };
        Tag: {
            archivedAt: string | null;
            /** Format: uuid */
            id: string;
            name: string;
            version: number;
        };
        TagCreate: {
            name: string;
        };
        TagList: {
            data: components["schemas"]["Tag"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        TagResponse: {
            data: components["schemas"]["Tag"];
            meta: components["schemas"]["Meta"];
        };
        TagUpdate: {
            name: string;
        };
        TestDeliveryCreate: {
            message?: string;
        };
        Transaction: {
            accountId: string | null;
            base: {
                amount: components["schemas"]["Decimal"];
                currency: components["schemas"]["Currency"];
                estimated: boolean;
            };
            categoryId: string | null;
            /**
             * Format: date-time
             * @description RFC 3339 UTC 时间
             */
            createdAt: string;
            exchangeRate: components["schemas"]["AppliedRate"] | null;
            /** Format: uuid */
            id: string;
            kind: components["schemas"]["TransactionKind"];
            /**
             * Format: date
             * @description 业务日期 YYYY-MM-DD，按账本 / 订阅时区解释
             */
            localDate: string;
            merchant: string | null;
            note: string | null;
            /**
             * Format: date-time
             * @description RFC 3339 UTC 时间
             */
            occurredAt: string;
            original: components["schemas"]["Money"];
            refundOf: string | null;
            replacesId: string | null;
            settlement: components["schemas"]["Money"];
            /** @enum {string} */
            source: "web" | "api" | "agent" | "import" | "subscription";
            /** @enum {string} */
            status: "posted" | "voided";
            tagIds: string[];
            timezone: string;
            transfer: {
                feeTransactionId: string | null;
                /** Format: uuid */
                sourceAccountId: string;
                sourceAmount: components["schemas"]["Money"];
                /** Format: uuid */
                targetAccountId: string;
                targetAmount: components["schemas"]["Money"];
            } | null;
            /**
             * Format: date-time
             * @description RFC 3339 UTC 时间
             */
            updatedAt: string;
            version: number;
        };
        /** @enum {string} */
        TransactionKind: "expense" | "income" | "transfer" | "refund";
        TransactionList: {
            data: components["schemas"]["Transaction"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        TransactionPreview: {
            accountDeltas: {
                /** Format: uuid */
                accountId: string;
                currency: components["schemas"]["Currency"];
                delta: components["schemas"]["Decimal"];
            }[];
            base: components["schemas"]["Money"];
            exchangeRate: components["schemas"]["AppliedRate"] | null;
            /**
             * Format: date-time
             * @description RFC 3339 UTC 时间
             */
            expiresAt: string;
            kind: components["schemas"]["TransactionKind"];
            normalizedInputHash: string;
            /** Format: uuid */
            previewId: string;
            settlement: components["schemas"]["Money"];
            warnings: {
                code: string;
                message: string;
            }[];
        };
        TransactionPreviewCreate: {
            /** Format: uuid */
            accountId: string;
            /** Format: uuid */
            categoryId?: string;
            /**
             * @default fresh-only
             * @enum {string}
             */
            fxPolicy: "fresh-only" | "accept-stale" | "manual";
            /** @enum {string} */
            kind: "expense" | "income";
            manualRate?: {
                reason: string;
                value: components["schemas"]["Rate"];
            };
            merchant?: string;
            note?: string;
            /**
             * Format: date-time
             * @description RFC 3339 UTC 时间
             */
            occurredAt: string;
            original?: components["schemas"]["Money"];
            settlement: components["schemas"]["Money"];
            tagIds?: string[];
            /** @description IANA 时区名 */
            timezone: string;
        } | {
            fee?: {
                amount: components["schemas"]["Money"];
                /** Format: uuid */
                categoryId?: string;
            };
            /**
             * @default fresh-only
             * @enum {string}
             */
            fxPolicy: "fresh-only" | "accept-stale" | "manual";
            /** @constant */
            kind: "transfer";
            manualRate?: {
                reason: string;
                value: components["schemas"]["Rate"];
            };
            note?: string;
            /**
             * Format: date-time
             * @description RFC 3339 UTC 时间
             */
            occurredAt: string;
            /** Format: uuid */
            sourceAccountId: string;
            sourceAmount: components["schemas"]["Money"];
            /** Format: uuid */
            targetAccountId: string;
            targetAmount: components["schemas"]["Money"];
            /** @description IANA 时区名 */
            timezone: string;
        } | {
            /** Format: uuid */
            accountId: string;
            /** @constant */
            kind: "refund";
            note?: string;
            /**
             * Format: date-time
             * @description RFC 3339 UTC 时间
             */
            occurredAt: string;
            /** @description 跨币种退款必填：按原支付币种计的退款金额，用于累计上限与基准币冲减 */
            originalAmount?: components["schemas"]["Money"];
            /** Format: uuid */
            originalTransactionId: string;
            settlement: components["schemas"]["Money"];
            /** @description IANA 时区名 */
            timezone: string;
        };
        TransactionPreviewList: {
            data: components["schemas"]["TransactionPreview"][];
            meta: components["schemas"]["Meta"];
            page: components["schemas"]["Page"];
        };
        TransactionPreviewResponse: {
            data: components["schemas"]["TransactionPreview"];
            meta: components["schemas"]["Meta"];
        };
        TransactionResponse: {
            data: components["schemas"]["Transaction"];
            meta: components["schemas"]["Meta"];
        };
    };
    responses: {
        /** @description 请求格式错误：JSON 无法解析、cursor 无效或 Idempotency-Key 缺失 / 格式错误 */
        BadRequest: {
            headers: {
                "X-Request-Id": components["headers"]["X-Request-Id"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description 业务冲突，或同一 Idempotency-Key 用于不同请求体 */
        Conflict: {
            headers: {
                "X-Request-Id": components["headers"]["X-Request-Id"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description 角色或作用域不足；写请求 Origin 校验失败 */
        Forbidden: {
            headers: {
                "X-Request-Id": components["headers"]["X-Request-Id"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description 资源不存在或无权访问（不区分两者） */
        NotFound: {
            headers: {
                "X-Request-Id": components["headers"]["X-Request-Id"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description 契约已发布、尚未实现（x-stability: planned） */
        NotImplemented: {
            headers: {
                "X-Request-Id": components["headers"]["X-Request-Id"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description 请求体超过限制 */
        PayloadTooLarge: {
            headers: {
                "X-Request-Id": components["headers"]["X-Request-Id"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description If-Match 与当前版本不符，请重新读取 */
        PreconditionFailed: {
            headers: {
                "X-Request-Id": components["headers"]["X-Request-Id"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description 缺少 If-Match */
        PreconditionRequired: {
            headers: {
                "X-Request-Id": components["headers"]["X-Request-Id"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description 依赖暂不可用，可稍后重试 */
        ServiceUnavailable: {
            headers: {
                "X-Request-Id": components["headers"]["X-Request-Id"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description 超过速率限制；参考 Retry-After */
        TooManyRequests: {
            headers: {
                "Retry-After": components["headers"]["Retry-After"];
                "X-Request-Id": components["headers"]["X-Request-Id"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description 未登录、会话已撤销或令牌无效 */
        Unauthorized: {
            headers: {
                "X-Request-Id": components["headers"]["X-Request-Id"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description 请使用 application/json */
        UnsupportedMediaType: {
            headers: {
                "X-Request-Id": components["headers"]["X-Request-Id"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description 字段校验失败；errors 列出路径与原因 */
        ValidationFailed: {
            headers: {
                "X-Request-Id": components["headers"]["X-Request-Id"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
    };
    parameters: {
        /** @description 同一 key + 同一请求体返回原结果；不同请求体返回 409。保留 7 天 */
        IdempotencyKey: string;
        /** @description 资金 / 投递类创建必须提供；同一 key + 同一请求体返回原结果 */
        IdempotencyKeyRequired: string;
        /** @description 上次读取到的 ETag，例如 "v3" */
        IfMatch: string;
    };
    requestBodies: never;
    headers: {
        /** @description 资源版本，例如 "v2" */
        ETag: string;
        /** @description true 表示返回的是同一 Idempotency-Key 首次请求的结果 */
        "Idempotent-Replayed": "true";
        /** @description 新资源或任务地址 */
        Location: string;
        /** @description 秒 */
        "Retry-After": number;
        /** @description 请求追踪 ID，同时出现在错误体 requestId */
        "X-Request-Id": string;
    };
    pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
    listApiTokens: {
        parameters: {
            query?: {
                /** @description 上一页返回的 nextCursor；篡改或与筛选条件不符返回 400 */
                cursor?: string;
                /** @description 每页条数，默认 50，最多 100 */
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 令牌元信息 */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiTokenList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createApiToken: {
        parameters: {
            query?: never;
            header?: {
                /** @description 同一 key + 同一请求体返回原结果；不同请求体返回 409。保留 7 天 */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ApiTokenCreate"];
            };
        };
        responses: {
            /** @description 签发 PAT（只显示一次） */
            201: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["Idempotent-Replayed"];
                    Location: components["headers"]["Location"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiTokenCreatedResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    revokeApiToken: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                tokenId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 撤销令牌，立即生效 */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createExchangeRateRefreshJob: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExchangeRateRefreshJobCreate"];
            };
        };
        responses: {
            /** @description 去重刷新任务（系统管理员） */
            202: {
                headers: {
                    Location: components["headers"]["Location"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExchangeRateRefreshJobResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getExchangeRateRefreshJob: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                jobId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 刷新任务状态（系统管理员） */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExchangeRateRefreshJobResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getExchangeRates: {
        parameters: {
            query: {
                /** @description RFC 3339 UTC 时间 */
                asOf?: string;
                base: "CNY" | "USD" | "HKD" | "EUR" | "JPY";
                /** @description 逗号分隔币种 */
                quotes: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 参考汇率与新鲜度 */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExchangeRatesResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listLedgers: {
        parameters: {
            query?: {
                /** @description 上一页返回的 nextCursor；篡改或与筛选条件不符返回 400 */
                cursor?: string;
                /** @description 每页条数，默认 50，最多 100 */
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 我可访问的账本 */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LedgerList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createLedger: {
        parameters: {
            query?: never;
            header?: {
                /** @description 同一 key + 同一请求体返回原结果；不同请求体返回 409。保留 7 天 */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LedgerCreate"];
            };
        };
        responses: {
            /** @description 新建账本，创建者成为 owner */
            201: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["Idempotent-Replayed"];
                    Location: components["headers"]["Location"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LedgerResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getLedger: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 账本详情 */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LedgerResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    updateLedger: {
        parameters: {
            query?: never;
            header: {
                /** @description 上次读取到的 ETag，例如 "v3" */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LedgerUpdate"];
            };
        };
        responses: {
            /** @description 修改账本名称 */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LedgerResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            412: components["responses"]["PreconditionFailed"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listAccounts: {
        parameters: {
            query?: {
                /** @description 上一页返回的 nextCursor；篡改或与筛选条件不符返回 400 */
                cursor?: string;
                includeArchived?: "true" | "false";
                /** @description 每页条数，默认 50，最多 100 */
                limit?: number;
            };
            header?: never;
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 账户列表 */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createAccount: {
        parameters: {
            query?: never;
            header?: {
                /** @description 同一 key + 同一请求体返回原结果；不同请求体返回 409。保留 7 天 */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AccountCreate"];
            };
        };
        responses: {
            /** @description 新建账户 */
            201: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["Idempotent-Replayed"];
                    Location: components["headers"]["Location"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getAccount: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                accountId: string;
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 账户详情与余额 */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    archiveAccount: {
        parameters: {
            query?: never;
            header: {
                /** @description 上次读取到的 ETag，例如 "v3" */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                accountId: string;
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 归档账户（保留历史） */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            412: components["responses"]["PreconditionFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    updateAccount: {
        parameters: {
            query?: never;
            header: {
                /** @description 上次读取到的 ETag，例如 "v3" */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                accountId: string;
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AccountUpdate"];
            };
        };
        responses: {
            /** @description 修改账户名称 / 备注 */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            412: components["responses"]["PreconditionFailed"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listApprovalRequests: {
        parameters: {
            query?: {
                /** @description 上一页返回的 nextCursor；篡改或与筛选条件不符返回 400 */
                cursor?: string;
                /** @description 每页条数，默认 50，最多 100 */
                limit?: number;
                status?: "pending" | "approved" | "rejected" | "expired" | "consumed";
            };
            header?: never;
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 待审批的高影响操作 */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApprovalRequestList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createApprovalRequest: {
        parameters: {
            query?: never;
            header?: {
                /** @description 同一 key + 同一请求体返回原结果；不同请求体返回 409。保留 7 天 */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ApprovalRequestCreate"];
            };
        };
        responses: {
            /** @description Agent 发起审批 */
            201: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["Idempotent-Replayed"];
                    Location: components["headers"]["Location"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApprovalRequestResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getApprovalRequest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                approvalId: string;
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 审批状态 */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApprovalRequestResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    updateApprovalRequest: {
        parameters: {
            query?: never;
            header: {
                /** @description 上次读取到的 ETag，例如 "v3" */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                approvalId: string;
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ApprovalRequestUpdate"];
            };
        };
        responses: {
            /** @description 批准 / 拒绝（仅 Web 用户） */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApprovalRequestResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            412: components["responses"]["PreconditionFailed"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listAuditEvents: {
        parameters: {
            query?: {
                action?: string;
                /** @description 上一页返回的 nextCursor；篡改或与筛选条件不符返回 400 */
                cursor?: string;
                /** @description 每页条数，默认 50，最多 100 */
                limit?: number;
            };
            header?: never;
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 审计事件（新到旧） */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditEventList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listBillOccurrences: {
        parameters: {
            query: {
                /** @description 上一页返回的 nextCursor；篡改或与筛选条件不符返回 400 */
                cursor?: string;
                /** @description 业务日期 YYYY-MM-DD，按账本 / 订阅时区解释 */
                dateFrom: string;
                /** @description 业务日期 YYYY-MM-DD，按账本 / 订阅时区解释 */
                dateTo: string;
                /** @description 每页条数，默认 50，最多 100 */
                limit?: number;
                status?: "scheduled" | "due" | "paid" | "skipped" | "overdue";
                subscriptionId?: string;
            };
            header?: never;
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 账单列表 / 日历 */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BillOccurrenceList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getBillOccurrence: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                ledgerId: string;
                occurrenceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 账单详情 */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BillOccurrenceResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    updateBillOccurrence: {
        parameters: {
            query?: never;
            header: {
                /** @description 上次读取到的 ETag，例如 "v3" */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                ledgerId: string;
                occurrenceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BillOccurrenceUpdate"];
            };
        };
        responses: {
            /** @description 跳过 / 恢复账单 */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BillOccurrenceResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            412: components["responses"]["PreconditionFailed"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createBillPayment: {
        parameters: {
            query?: never;
            header: {
                /** @description 资金 / 投递类创建必须提供；同一 key + 同一请求体返回原结果 */
                "Idempotency-Key": components["parameters"]["IdempotencyKeyRequired"];
            };
            path: {
                ledgerId: string;
                occurrenceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BillPaymentCreate"];
            };
        };
        responses: {
            /** @description 记录实际支付，唯一关联交易（不是银行扣款） */
            201: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["Idempotent-Replayed"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BillPaymentResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listBudgets: {
        parameters: {
            query?: {
                /** @description 上一页返回的 nextCursor；篡改或与筛选条件不符返回 400 */
                cursor?: string;
                /** @description 每页条数，默认 50，最多 100 */
                limit?: number;
            };
            header?: never;
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 预算 */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BudgetList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createBudget: {
        parameters: {
            query?: never;
            header?: {
                /** @description 同一 key + 同一请求体返回原结果；不同请求体返回 409。保留 7 天 */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BudgetCreate"];
            };
        };
        responses: {
            /** @description 新建预算 */
            201: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["Idempotent-Replayed"];
                    Location: components["headers"]["Location"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BudgetResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    archiveBudget: {
        parameters: {
            query?: never;
            header: {
                /** @description 上次读取到的 ETag，例如 "v3" */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                budgetId: string;
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 归档预算 */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BudgetResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            412: components["responses"]["PreconditionFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    updateBudget: {
        parameters: {
            query?: never;
            header: {
                /** @description 上次读取到的 ETag，例如 "v3" */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                budgetId: string;
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BudgetUpdate"];
            };
        };
        responses: {
            /** @description 修改预算 */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BudgetResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            412: components["responses"]["PreconditionFailed"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listCategories: {
        parameters: {
            query?: {
                /** @description 上一页返回的 nextCursor；篡改或与筛选条件不符返回 400 */
                cursor?: string;
                includeArchived?: "true" | "false";
                /** @description 每页条数，默认 50，最多 100 */
                limit?: number;
            };
            header?: never;
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 分类 */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CategoryList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createCategory: {
        parameters: {
            query?: never;
            header?: {
                /** @description 同一 key + 同一请求体返回原结果；不同请求体返回 409。保留 7 天 */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CategoryCreate"];
            };
        };
        responses: {
            /** @description 新建分类 */
            201: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["Idempotent-Replayed"];
                    Location: components["headers"]["Location"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CategoryResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    archiveCategory: {
        parameters: {
            query?: never;
            header: {
                /** @description 上次读取到的 ETag，例如 "v3" */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                categoryId: string;
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 归档分类（已引用的只归档） */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CategoryResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            412: components["responses"]["PreconditionFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    updateCategory: {
        parameters: {
            query?: never;
            header: {
                /** @description 上次读取到的 ETag，例如 "v3" */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                categoryId: string;
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CategoryUpdate"];
            };
        };
        responses: {
            /** @description 修改分类 */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CategoryResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            412: components["responses"]["PreconditionFailed"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listExportJobs: {
        parameters: {
            query?: {
                /** @description 上一页返回的 nextCursor；篡改或与筛选条件不符返回 400 */
                cursor?: string;
                /** @description 每页条数，默认 50，最多 100 */
                limit?: number;
            };
            header?: never;
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 我创建的导出任务 */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExportJobList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createExportJob: {
        parameters: {
            query?: never;
            header?: {
                /** @description 同一 key + 同一请求体返回原结果；不同请求体返回 409。保留 7 天 */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExportJobCreate"];
            };
        };
        responses: {
            /** @description 创建导出任务 */
            202: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["Idempotent-Replayed"];
                    Location: components["headers"]["Location"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExportJobResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getExportJob: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                exportJobId: string;
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 导出状态与短期下载地址 */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExportJobResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    downloadExportFile: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                exportJobId: string;
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 下载导出文件（仅创建者，1 小时内） */
            200: {
                headers: {
                    /** @description attachment; filename*=UTF-8''… */
                    "Content-Disposition"?: string;
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "text/csv": string;
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listImportJobs: {
        parameters: {
            query?: {
                /** @description 上一页返回的 nextCursor；篡改或与筛选条件不符返回 400 */
                cursor?: string;
                /** @description 每页条数，默认 50，最多 100 */
                limit?: number;
            };
            header?: never;
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 导入任务（新到旧） */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportJobList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createImportJob: {
        parameters: {
            query?: never;
            header: {
                /** @description 资金 / 投递类创建必须提供；同一 key + 同一请求体返回原结果 */
                "Idempotency-Key": components["parameters"]["IdempotencyKeyRequired"];
            };
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["ImportJobCreate"];
            };
        };
        responses: {
            /** @description 上传 CSV，异步校验并生成预览 */
            202: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["Idempotent-Replayed"];
                    Location: components["headers"]["Location"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportJobResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getImportJob: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                importJobId: string;
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 导入任务状态与行级错误 */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportJobResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createImportCommit: {
        parameters: {
            query?: never;
            header: {
                /** @description 资金 / 投递类创建必须提供；同一 key + 同一请求体返回原结果 */
                "Idempotency-Key": components["parameters"]["IdempotencyKeyRequired"];
            };
            path: {
                importJobId: string;
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 提交已校验批次（异步入账） */
            202: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["Idempotent-Replayed"];
                    Location: components["headers"]["Location"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportJobResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            415: components["responses"]["UnsupportedMediaType"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createImportReversal: {
        parameters: {
            query?: never;
            header: {
                /** @description 资金 / 投递类创建必须提供；同一 key + 同一请求体返回原结果 */
                "Idempotency-Key": components["parameters"]["IdempotencyKeyRequired"];
            };
            path: {
                importJobId: string;
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 撤销该批次生成的账务（异步作废） */
            202: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["Idempotent-Replayed"];
                    Location: components["headers"]["Location"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportJobResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            415: components["responses"]["UnsupportedMediaType"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listManualRateRecords: {
        parameters: {
            query?: {
                /** @description 上一页返回的 nextCursor；篡改或与筛选条件不符返回 400 */
                cursor?: string;
                /** @description 每页条数，默认 50，最多 100 */
                limit?: number;
            };
            header?: never;
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 账本的人工汇率记录（新到旧） */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ManualRateRecordList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createManualRateRecord: {
        parameters: {
            query?: never;
            header?: {
                /** @description 同一 key + 同一请求体返回原结果；不同请求体返回 409。保留 7 天 */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ManualRateRecordCreate"];
            };
        };
        responses: {
            /** @description 有理由的人工汇率 */
            201: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["Idempotent-Replayed"];
                    Location: components["headers"]["Location"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ManualRateRecordResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listMemberships: {
        parameters: {
            query?: {
                /** @description 上一页返回的 nextCursor；篡改或与筛选条件不符返回 400 */
                cursor?: string;
                /** @description 每页条数，默认 50，最多 100 */
                limit?: number;
            };
            header?: never;
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 账本成员 */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MembershipList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createMembership: {
        parameters: {
            query?: never;
            header?: {
                /** @description 同一 key + 同一请求体返回原结果；不同请求体返回 409。保留 7 天 */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MembershipCreate"];
            };
        };
        responses: {
            /** @description 添加已注册成员 */
            201: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["Idempotent-Replayed"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MembershipResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    deleteMembership: {
        parameters: {
            query?: never;
            header: {
                /** @description 上次读取到的 ETag，例如 "v3" */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                ledgerId: string;
                membershipId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 移除成员，保护最后 owner */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    updateMembership: {
        parameters: {
            query?: never;
            header: {
                /** @description 上次读取到的 ETag，例如 "v3" */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                ledgerId: string;
                membershipId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MembershipUpdate"];
            };
        };
        responses: {
            /** @description 修改成员角色，保护最后 owner */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MembershipResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listNotificationDeliveries: {
        parameters: {
            query?: {
                channelId?: string;
                /** @description 上一页返回的 nextCursor；篡改或与筛选条件不符返回 400 */
                cursor?: string;
                /** @description 业务日期 YYYY-MM-DD，按账本 / 订阅时区解释 */
                dateFrom?: string;
                /** @description 业务日期 YYYY-MM-DD，按账本 / 订阅时区解释 */
                dateTo?: string;
                /** @description 每页条数，默认 50，最多 100 */
                limit?: number;
                status?: "queued" | "sending" | "accepted" | "delivered" | "failed" | "delivery_unknown" | "expired" | "cancelled";
            };
            header?: never;
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 投递记录与平台状态 */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationDeliveryList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getNotificationDelivery: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                deliveryId: string;
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 投递详情 */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationDeliveryResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listNotifications: {
        parameters: {
            query?: {
                /** @description 上一页返回的 nextCursor；篡改或与筛选条件不符返回 400 */
                cursor?: string;
                /** @description 每页条数，默认 50，最多 100 */
                limit?: number;
                unreadOnly?: "true" | "false";
            };
            header?: never;
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 站内通知 */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getNotification: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                ledgerId: string;
                notificationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 站内通知详情 */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    updateNotification: {
        parameters: {
            query?: never;
            header: {
                /** @description 上次读取到的 ETag，例如 "v3" */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                ledgerId: string;
                notificationId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NotificationUpdate"];
            };
        };
        responses: {
            /** @description 标记已读 / 未读 */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            412: components["responses"]["PreconditionFailed"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getOperation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                ledgerId: string;
                operationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 写入结果 / 异步操作状态（原 actor） */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OperationResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createReminderPreview: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReminderPreviewCreate"];
            };
        };
        responses: {
            /** @description 未来三次提醒时间与免打扰影响 */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReminderPreviewResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listReminderRules: {
        parameters: {
            query?: {
                /** @description 上一页返回的 nextCursor；篡改或与筛选条件不符返回 400 */
                cursor?: string;
                /** @description 每页条数，默认 50，最多 100 */
                limit?: number;
            };
            header?: never;
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 提醒规则 */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReminderRuleList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createReminderRule: {
        parameters: {
            query?: never;
            header: {
                /** @description 资金 / 投递类创建必须提供；同一 key + 同一请求体返回原结果 */
                "Idempotency-Key": components["parameters"]["IdempotencyKeyRequired"];
            };
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PreviewSubmit"];
            };
        };
        responses: {
            /** @description 提交预览创建规则 */
            201: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["Idempotent-Replayed"];
                    Location: components["headers"]["Location"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReminderRuleResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    deleteReminderRule: {
        parameters: {
            query?: never;
            header: {
                /** @description 上次读取到的 ETag，例如 "v3" */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                ledgerId: string;
                ruleId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 停用规则并取消未发送任务 */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            412: components["responses"]["PreconditionFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    updateReminderRule: {
        parameters: {
            query?: never;
            header: {
                /** @description 上次读取到的 ETag，例如 "v3" */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                ledgerId: string;
                ruleId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReminderRuleUpdate"];
            };
        };
        responses: {
            /** @description 修改规则 */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReminderRuleResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            412: components["responses"]["PreconditionFailed"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getAccountBalances: {
        parameters: {
            query?: {
                /** @description RFC 3339 UTC 时间 */
                asOf?: string;
                currency?: "CNY" | "USD" | "HKD" | "EUR" | "JPY";
            };
            header?: never;
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 账户余额与净资产估值 */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountBalancesResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getBudgetProgress: {
        parameters: {
            query?: {
                /** @description 统计包含该日的周期，默认账本时区今天 */
                date?: string;
            };
            header?: never;
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 预算进度与阈值 */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BudgetProgressResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getCashFlow: {
        parameters: {
            query: {
                accountId?: string;
                categoryId?: string;
                currency?: "CNY" | "USD" | "HKD" | "EUR" | "JPY";
                /** @description 业务日期 YYYY-MM-DD，按账本 / 订阅时区解释 */
                dateFrom: string;
                /** @description 业务日期 YYYY-MM-DD，按账本 / 订阅时区解释 */
                dateTo: string;
                interval?: "day" | "week" | "month";
                /** @description historical 使用入账时 base_amount；current 按 asOf 参考汇率估值 */
                valuationMode?: "historical" | "current";
            };
            header?: never;
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 收支趋势 */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CashFlowResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getCategoryBreakdown: {
        parameters: {
            query: {
                accountId?: string;
                categoryId?: string;
                currency?: "CNY" | "USD" | "HKD" | "EUR" | "JPY";
                /** @description 业务日期 YYYY-MM-DD，按账本 / 订阅时区解释 */
                dateFrom: string;
                /** @description 业务日期 YYYY-MM-DD，按账本 / 订阅时区解释 */
                dateTo: string;
                kind?: "expense" | "income";
                /** @description historical 使用入账时 base_amount；current 按 asOf 参考汇率估值 */
                valuationMode?: "historical" | "current";
            };
            header?: never;
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 分类排行 */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CategoryBreakdownResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getReportSummary: {
        parameters: {
            query: {
                accountId?: string;
                categoryId?: string;
                currency?: "CNY" | "USD" | "HKD" | "EUR" | "JPY";
                /** @description 业务日期 YYYY-MM-DD，按账本 / 订阅时区解释 */
                dateFrom: string;
                /** @description 业务日期 YYYY-MM-DD，按账本 / 订阅时区解释 */
                dateTo: string;
                /** @description historical 使用入账时 base_amount；current 按 asOf 参考汇率估值 */
                valuationMode?: "historical" | "current";
            };
            header?: never;
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description KPI 汇总 */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReportSummaryResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createSubscriptionPreview: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubscriptionPreviewCreate"];
            };
        };
        responses: {
            /** @description 校验周期并展示未来三次 */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SubscriptionPreviewResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listSubscriptions: {
        parameters: {
            query?: {
                /** @description 上一页返回的 nextCursor；篡改或与筛选条件不符返回 400 */
                cursor?: string;
                /** @description 每页条数，默认 50，最多 100 */
                limit?: number;
                status?: "active" | "paused" | "cancelled";
            };
            header?: never;
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 周期订阅 */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SubscriptionList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createSubscription: {
        parameters: {
            query?: never;
            header: {
                /** @description 资金 / 投递类创建必须提供；同一 key + 同一请求体返回原结果 */
                "Idempotency-Key": components["parameters"]["IdempotencyKeyRequired"];
            };
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PreviewSubmit"];
            };
        };
        responses: {
            /** @description 提交预览创建订阅 */
            201: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["Idempotent-Replayed"];
                    Location: components["headers"]["Location"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SubscriptionResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getSubscription: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                ledgerId: string;
                subscriptionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 订阅详情 */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SubscriptionResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    updateSubscription: {
        parameters: {
            query?: never;
            header: {
                /** @description 上次读取到的 ETag，例如 "v3" */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                ledgerId: string;
                subscriptionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubscriptionUpdate"];
            };
        };
        responses: {
            /** @description 修改、暂停、取消（状态字段） */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SubscriptionResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            412: components["responses"]["PreconditionFailed"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listTags: {
        parameters: {
            query?: {
                /** @description 上一页返回的 nextCursor；篡改或与筛选条件不符返回 400 */
                cursor?: string;
                includeArchived?: "true" | "false";
                /** @description 每页条数，默认 50，最多 100 */
                limit?: number;
            };
            header?: never;
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 标签 */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TagList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createTag: {
        parameters: {
            query?: never;
            header?: {
                /** @description 同一 key + 同一请求体返回原结果；不同请求体返回 409。保留 7 天 */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TagCreate"];
            };
        };
        responses: {
            /** @description 新建标签 */
            201: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["Idempotent-Replayed"];
                    Location: components["headers"]["Location"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TagResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    archiveTag: {
        parameters: {
            query?: never;
            header: {
                /** @description 上次读取到的 ETag，例如 "v3" */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                ledgerId: string;
                tagId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 归档标签 */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TagResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            412: components["responses"]["PreconditionFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    updateTag: {
        parameters: {
            query?: never;
            header: {
                /** @description 上次读取到的 ETag，例如 "v3" */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                ledgerId: string;
                tagId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TagUpdate"];
            };
        };
        responses: {
            /** @description 修改标签 */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TagResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createTransactionPreview: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TransactionPreviewCreate"];
            };
        };
        responses: {
            /** @description 预览：规范化金额、余额影响、锁定汇率 */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TransactionPreviewResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listTransactions: {
        parameters: {
            query?: {
                accountId?: string;
                categoryId?: string;
                /** @description 上一页返回的 nextCursor；篡改或与筛选条件不符返回 400 */
                cursor?: string;
                /** @description 含当日，按账本时区 */
                dateFrom?: string;
                /** @description 不含当日 */
                dateTo?: string;
                kind?: "expense" | "income" | "transfer" | "refund";
                /** @description 每页条数，默认 50，最多 100 */
                limit?: number;
                q?: string;
                sort?: "-localDate" | "localDate" | "-amount" | "amount";
                /** @description 默认只列有效交易；被更正或作废的旧版本用 voided / all 查看 */
                status?: "posted" | "voided" | "all";
            };
            header?: never;
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 明细、筛选与分页 */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TransactionList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createTransaction: {
        parameters: {
            query?: never;
            header: {
                /** @description 资金 / 投递类创建必须提供；同一 key + 同一请求体返回原结果 */
                "Idempotency-Key": components["parameters"]["IdempotencyKeyRequired"];
            };
            path: {
                ledgerId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PreviewSubmit"];
            };
        };
        responses: {
            /** @description 提交预览，新建收支或转账 */
            201: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["Idempotent-Replayed"];
                    Location: components["headers"]["Location"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TransactionResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getTransaction: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                ledgerId: string;
                transactionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 交易详情 */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TransactionResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    voidTransaction: {
        parameters: {
            query?: never;
            header: {
                /** @description 上次读取到的 ETag，例如 "v3" */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                ledgerId: string;
                transactionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 作废：创建反向 posting，重复作废无影响 */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TransactionResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    updateTransaction: {
        parameters: {
            query?: never;
            header: {
                /** @description 同一 key + 同一请求体返回原结果；不同请求体返回 409。保留 7 天 */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description 上次读取到的 ETag，例如 "v3" */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                ledgerId: string;
                transactionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PreviewSubmit"];
            };
        };
        responses: {
            /** @description 更正：同事务冲正并生成新版本 */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["Idempotent-Replayed"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TransactionResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createRefund: {
        parameters: {
            query?: never;
            header: {
                /** @description 资金 / 投递类创建必须提供；同一 key + 同一请求体返回原结果 */
                "Idempotency-Key": components["parameters"]["IdempotencyKeyRequired"];
            };
            path: {
                ledgerId: string;
                transactionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PreviewSubmit"];
            };
        };
        responses: {
            /** @description 关联退款，累计不超过原支付 */
            201: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["Idempotent-Replayed"];
                    Location: components["headers"]["Location"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TransactionResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 当前身份、账本列表与有效作用域 */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MeResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getPreferences: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 外观偏好 */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PreferencesResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    updatePreferences: {
        parameters: {
            query?: never;
            header: {
                /** @description 上次读取到的 ETag，例如 "v3" */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PreferencesUpdate"];
            };
        };
        responses: {
            /** @description 修改外观偏好 */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PreferencesResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            412: components["responses"]["PreconditionFailed"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listNotificationChannels: {
        parameters: {
            query?: {
                /** @description 上一页返回的 nextCursor；篡改或与筛选条件不符返回 400 */
                cursor?: string;
                /** @description 每页条数，默认 50，最多 100 */
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 我的通知渠道 */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationChannelList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createNotificationChannel: {
        parameters: {
            query?: never;
            header?: {
                /** @description 同一 key + 同一请求体返回原结果；不同请求体返回 409。保留 7 天 */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NotificationChannelCreate"];
            };
        };
        responses: {
            /** @description 配置渠道（凭据加密保存） */
            201: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["Idempotent-Replayed"];
                    Location: components["headers"]["Location"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationChannelResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    deleteNotificationChannel: {
        parameters: {
            query?: never;
            header: {
                /** @description 上次读取到的 ETag，例如 "v3" */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                channelId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 删除渠道配置 */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            412: components["responses"]["PreconditionFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    updateNotificationChannel: {
        parameters: {
            query?: never;
            header: {
                /** @description 上次读取到的 ETag，例如 "v3" */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                channelId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NotificationChannelUpdate"];
            };
        };
        responses: {
            /** @description 修改 / 停用渠道 */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationChannelResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            412: components["responses"]["PreconditionFailed"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createTestDelivery: {
        parameters: {
            query?: never;
            header: {
                /** @description 资金 / 投递类创建必须提供；同一 key + 同一请求体返回原结果 */
                "Idempotency-Key": components["parameters"]["IdempotencyKeyRequired"];
            };
            path: {
                channelId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TestDeliveryCreate"];
            };
        };
        responses: {
            /** @description 创建测试投递 */
            202: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["Idempotent-Replayed"];
                    Location: components["headers"]["Location"];
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationDeliveryResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["ValidationFailed"];
            429: components["responses"]["TooManyRequests"];
            501: components["responses"]["NotImplemented"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
}
