/* ============================================================================
 * 九江 · 买卖合同欠款纠纷 —— 立案文书契约
 * ----------------------------------------------------------------------------
 * 这个文件是「5 份固定文书」的唯一真相源。
 *
 * 设计原则：从输出反推输入
 *   5 份文书（固定契约）→ 每份拆成「材料项」→ 每项标必选/选填
 *     → 每项声明涉及哪些字段 → 字段就是表单要填、校验要查、AI 要问的东西
 *
 * 换地区（南昌、赣州……）只要复制本文件改 region / courts / documents，
 * 然后在 index.html 里替换 <script src="./contracts/jiujiang.js">。
 * 表单、校验、进度、文书生成、AI 工具面全部从本契约派生，其他代码不用改。
 *
 * 材料项 requirement 取值：
 *   required     必选，缺了立案窗口会退
 *   conditional  条件必选，when() 成立时才算必选
 *   optional     选填，不计入进度
 *   fixed        固定文本或自动派生，无需用户输入，不计入进度
 *
 * 每个材料项可声明：
 *   fields          本项涉及的字段（用于契约自检 + AI 定位，不必全部必填）
 *   requiredFields  本项要求非空的字段，默认等于 fields
 *   check           自定义判定，覆盖 requiredFields 的「全部非空」
 *   hint            缺项时给用户和 AI 的说明（AI 追问话术的种子）
 * ========================================================================== */
((global) => {
  /* 有 / 无 书面合同：贯穿文书分叉的判定 */
  function hasWrittenContract(s) {
    return s.contractForm === "书面买卖合同";
  }

  var contract = {
    region: "九江",
    version: 1,

    /* 拟提交法院（九江辖区基层法院） */
    courts: [
      "九江市浔阳区人民法院",
      "九江市濂溪区人民法院",
      "九江市柴桑区人民法院",
      "九江经济技术开发区人民法院",
      "瑞昌市人民法院",
      "共青城市人民法院",
      "庐山市人民法院",
      "武宁县人民法院",
      "修水县人民法院",
      "永修县人民法院",
      "德安县人民法院",
      "都昌县人民法院",
      "湖口县人民法院",
      "彭泽县人民法院",
    ],

    /* 管辖连接点：勾选项 → 起诉状「管辖依据」段的表述
     * text(s) 里的占位符由 app.js 的 valueOr 兜底成 ____ */
    /* 管辖连接点：勾选项 → 起诉状「管辖依据」段的表述
     * text(s, v) 里的 v 是 app.js 传入的 valueOr：
     * 它会把用户填的值包上屏幕预览/打印用的标记，并做 HTML 转义。 */
    jurisdictionGrounds: [
      {
        value: "被告住所地或公司登记地在九江",
        short: "被告住所地/登记地在九江",
        text: (s, v) => "被告住所地（" + v(s.defendantAddress) + "）在你院辖区",
      },
      {
        value:
          "原告住所地在九江（货款为给付货币，接收货币一方所在地为合同履行地）",
        short: "原告住所地（收款方）在九江",
        text: (s, v) =>
          "本案争议标的为给付货币，原告作为接收货币一方，其住所地（" +
          v(s.plaintiffAddress) +
          "）为合同履行地，在你院辖区",
      },
      {
        value: "合同履行地或交货地在九江",
        short: "合同履行地/交货地在九江",
        text: (s, v) =>
          "即使以货物交付地认定合同履行地，该交付地（" +
          v(s.deliveryPlace) +
          "）亦在你院辖区",
      },
      {
        value: "合同约定由九江辖区法院管辖",
        short: "书面合同约定九江法院管辖",
        writtenContractOnly: true,
        text: () => "双方以书面合同约定由你院管辖",
      },
      {
        value: "其他与九江有关的连接点",
        short: "其他九江连接点",
        text: (s, v) => v(s.jurisdictionNote, "本案其他管辖连接点位于你院辖区"),
      },
    ],

    /* 证据分类 → 证明目的（证据目录与上传区共用） */
    evidencePurposes: {
      订货约定: "证明双方达成买卖交易及货物、数量、价格等约定",
      送货签收: "证明原告已经交付货物以及被告接收货物",
      价格结算: "证明交易价格、结算金额和欠付货款数额",
      付款记录: "证明被告部分付款及尚欠货款数额",
      催款认账: "证明付款期限届满、原告催款以及被告承认交易或欠款",
      被告信息: "证明被告主体名称、地址或联系方式",
      其他: "证明与本案有关的事实",
    },

    /* 九江辖区基层法院当前“民事一审”平台上传栏目。
     * 2026-09-25 通过人民法院在线服务全国版实时配置核对，14 家基层法院一致。 */
    platformMaterials: [
      {
        id: "court-complaint",
        title: "起诉状",
        folder: "01_起诉状",
        requirement: "required",
        step: 0,
        check: (s) =>
          Boolean(
            s.plaintiffName &&
              s.defendantName &&
              s.contractForm &&
              s.goods &&
              s.totalAmount &&
              s.dueDate &&
              s.demandHistory,
          ),
        hint: "法院平台必传。工具根据当事人、诉讼请求、事实与理由自动生成。",
      },
      {
        id: "court-identity",
        title: "当事人身份证明",
        folder: "02_当事人身份证明",
        requirement: "required",
        step: 1,
        fields: ["identityMaterials", "uploads:plaintiff"],
        check: (s, up) =>
          Array.isArray(s.identityMaterials) &&
          s.identityMaterials.length > 0 &&
          s.identityMaterials.every(
            (material) =>
              material.name &&
              up.plaintiff.some((file) => file.materialId === material.id),
          ),
        hint: "法院平台必传。个人上传身份证正反面；经营主体上传营业执照及负责人身份证明。",
      },
      {
        id: "court-agent",
        title: "委托代理人委托手续和身份材料",
        folder: "03_委托代理人委托手续和身份材料",
        requirement: "conditional",
        when: (s) => s.represented === "yes",
        step: 1,
        check: (s, up) =>
          Boolean(s.agentName && s.agentType && s.agentId && s.agentPhone) &&
          up.agent.length > 0,
        hint: "法院平台标记为非必传；选择委托代理人时应填写代理人信息并上传授权及身份证明。",
      },
      {
        id: "court-evidence",
        title: "证据目录及证据材料",
        folder: "04_证据目录及证据材料",
        requirement: "required",
        step: 3,
        check: (s, up) =>
          s.evidence.length > 0 &&
          s.evidence.every((item) => {
            if (!item.name || !item.source || !item.purpose) return false;
            if (item.kind === "media")
              return Boolean(item.mediaType && Number(item.fileCount) > 0);
            return up.evidence.some((file) => file.evidenceId === item.id);
          }),
        hint: "法院平台必传。图文证据需上传至少一个文件；影音证据需填写类型和数量，并在法院平台另行上传原文件。",
      },
      {
        id: "court-service",
        title: "送达地址确认书",
        folder: "05_送达地址确认书",
        requirement: "required",
        step: 4,
        fields: ["serviceRecipient", "serviceAddress", "servicePhone"],
        hint: "法院平台必传。地址、手机和电子送达方式应长期有效。",
      },
      {
        id: "court-refund",
        title: "收款账户确认书",
        folder: "06_收款账户确认书",
        requirement: "conditional",
        when: (s) => Boolean(s.includeRefundAccount),
        step: 4,
        fields: [
          "refundAccountName",
          "refundBankName",
          "refundBankAccount",
          "refundPhone",
        ],
        hint: "法院平台标记为非必传；勾选生成时需填写完整账户资料。",
      },
    ],

    /* ======================================================================
     * 六份可生成文书（其中原告材料、被告线索为辅助核对材料）
     * ==================================================================== */
    documents: [
      /* ------------------------------------------------------------------
       * 01 民事起诉状
       * ---------------------------------------------------------------- */
      {
        id: "complaint",
        title: "民事起诉状",
        filename: "01_民事起诉状_买卖合同纠纷",
        sections: [
          {
            id: "plaintiff-party",
            title: "原告姓名/名称、证件号码、住所地、电话",
            step: 0,
            requirement: "required",
            fields: ["plaintiffType", "plaintiffName", "plaintiffId", "plaintiffAddress", "plaintiffPhone", "plaintiffGender", "plaintiffCountry", "plaintiffIdType", "plaintiffLicenseType"],
            check: (s) =>
              s.plaintiffType === "个人"
                ? Boolean(s.plaintiffName && s.plaintiffGender && s.plaintiffCountry && s.plaintiffIdType && s.plaintiffId && s.plaintiffAddress && s.plaintiffPhone)
                : Boolean(s.plaintiffName && s.plaintiffCountry && s.plaintiffLicenseType && s.plaintiffId && s.plaintiffAddress && s.plaintiffPhone),
            hint: "起诉状必须写全原告的名称、证件号码（身份证号或统一社会信用代码）、住所地和联系电话",
          },
          {
            id: "plaintiff-rep",
            title: "原告法定代表人 / 经营者及职务",
            step: 0,
            requirement: "conditional",
            when: (s) => s.plaintiffType !== "个人",
            fields: ["plaintiffRepresentative", "plaintiffRepresentativeTitle", "plaintiffRepresentativePhone"],
            requiredFields: ["plaintiffRepresentativePhone"],
            hint: "个体工商户或公司起诉，起诉状需注明经营者 / 法定代表人的姓名和职务",
          },
          {
            id: "defendant-party",
            title: "被告名称与住所地",
            step: 0,
            requirement: "required",
            fields: ["defendantType", "defendantName", "defendantAddress", "defendantGender", "defendantCountry", "defendantIdType", "defendantLicenseType"],
            check: (s) =>
              s.defendantType === "个人"
                ? Boolean(s.defendantName && s.defendantGender && s.defendantCountry && s.defendantAddress)
                : Boolean(s.defendantName && s.defendantCountry && s.defendantLicenseType && s.defendantAddress),
            hint: "被告的名称和住所地是立案必备信息，直接决定管辖和送达",
          },
          {
            id: "defendant-rep",
            title: "被告法定代表人 / 经营者",
            step: 0,
            requirement: "optional",
            fields: ["defendantRepresentative", "defendantRepresentativePhone"],
            hint: "被告是公司或个体工商户时，起诉状需写明其法定代表人 / 经营者；不知道可留空，法院可依职权查明",
          },
          {
            id: "trade-basis",
            title: "交易基础：有无书面合同及交易经过",
            step: 0,
            requirement: "required",
            fields: [
              "contractForm",
              "contractDate",
              "contractName",
              "goods",
              "dealFormation",
              "deliveryReceipt",
              "priceBasis",
              "debtAcknowledgement",
            ],
            check: (s) => {
              if (!s.contractForm) return false;
              if (!s.contractDate || !s.goods) return false;
              if (hasWrittenContract(s)) return true;
              return Boolean(
                s.dealFormation && s.deliveryReceipt && s.priceBasis,
              );
            },
            hint: "有书面合同：填合同日期和货物即可。无书面合同：还必须说明交易如何达成、送货单由谁签收、价格和结算依据是什么",
          },
          {
            id: "delivery-fact",
            title: "交付、签收与验收事实",
            step: 0,
            requirement: "required",
            fields: ["deliveryPlace", "deliveryDetails", "deliveryDate"],
            requiredFields: ["deliveryPlace", "deliveryDetails"],
            hint: "起诉状需写明货物交付的地点，以及签收、验收、有无质量异议的情况",
          },
          {
            id: "debt-amount",
            title: "货款金额、付款到期日与拒付理由",
            step: 0,
            requirement: "required",
            fields: [
              "totalAmount",
              "paidAmount",
              "dueDate",
              "paymentTerms",
              "qualityDispute",
              "qualityDetails",
            ],
            check: (s) => Number(s.totalAmount) > 0 && Boolean(s.dueDate),
            hint: "货款总额必须大于 0，并且必须填写付款到期日（决定逾期利息起算点）",
          },
          {
            id: "demand-history",
            title: "催款经过",
            step: 0,
            requirement: "required",
            fields: ["demandHistory"],
            hint: "按时间写明微信、电话、催款函等催款经过，以及对方如何回复",
          },
          {
            id: "claim-interest",
            title: "诉讼请求：逾期利息 / 违约金计算方式",
            step: 0,
            requirement: "conditional",
            when: (s) => Boolean(s.claimInterest),
            fields: ["claimInterest", "interestTerms"],
            requiredFields: ["interestTerms"],
            hint: "已勾选主张逾期利息 / 违约金，必须写明计算方式，否则诉讼请求不明确、无法计算受理费",
          },
          {
            id: "claim-attorney-fee",
            title: "诉讼请求：实现债权费用及依据",
            step: 0,
            requirement: "conditional",
            when: (s) => Boolean(s.claimAttorneyFee),
            fields: ["claimAttorneyFee", "attorneyFeeTerms"],
            requiredFields: ["attorneyFeeTerms"],
            hint: "已勾选主张律师费等实现债权费用，需写明金额，并说明合同依据或实际发生的凭证",
          },
          {
            id: "claim-costs",
            title: "诉讼请求：诉讼费用承担",
            step: 0,
            requirement: "fixed",
            fields: ["claimCosts"],
          },
          {
            id: "court-selection",
            title: "拟提交法院",
            step: 0,
            requirement: "required",
            fields: ["court"],
            hint: "必须选择拟提交的九江辖区基层法院",
          },
          {
            id: "jurisdiction-grounds",
            title: "管辖依据：九江连接点",
            step: 0,
            requirement: "required",
            fields: [
              "jurisdictionBases",
              "jurisdictionNote",
              "arbitration",
              "deliveryPlace",
              "defendantAddress",
              "plaintiffAddress",
            ],
            check: (s) =>
              Array.isArray(s.jurisdictionBases) &&
              s.jurisdictionBases.length > 0,
            hint: "必须至少勾选一项九江管辖连接点。仅因原告居住在九江并不当然取得管辖，需对应到被告住所地、合同履行地（收款方所在地或交货地）或合同约定",
          },
          {
            id: "jurisdiction-clause",
            title: "书面合同中的管辖约定",
            step: 0,
            requirement: "conditional",
            when: (s) =>
              hasWrittenContract(s) && s.jurisdictionAgreement === "yes",
            fields: ["jurisdictionAgreement", "jurisdictionClause"],
            requiredFields: ["jurisdictionClause"],
            hint: "已选择书面合同约定了管辖法院，必须填写约定的具体内容，否则起诉状无法写明协议管辖依据",
          },
          {
            id: "attachments",
            title: "附项：起诉状副本与证据份数",
            step: 0,
            requirement: "fixed",
          },
        ],
      },

      /* ------------------------------------------------------------------
       * 02 当事人身份证明（目录封面 + 原告身份材料）
       * ---------------------------------------------------------------- */
      {
        id: "plaintiff",
        title: "当事人身份证明",
        filename: "02_当事人身份证明",
        sections: [
          {
            id: "plaintiff-identity-file",
            title: "原告身份材料",
            step: 1,
            requirement: "required",
            fields: ["identityMaterials", "uploads:plaintiff", "plaintiffType"],
            check: (s, up) =>
              Array.isArray(s.identityMaterials) &&
              s.identityMaterials.length > 0 &&
              s.identityMaterials.every(
                (material) =>
                  material.name &&
                  up.plaintiff.some((file) => file.materialId === material.id),
              ),
            hint: "个人：身份证正反面；个体工商户：营业执照 + 经营者身份证；公司：营业执照 + 法定代表人身份证明 + 法定代表人身份证",
          },
          {
            id: "agent-file",
            title: "授权委托书及代理人身份证明",
            step: 1,
            requirement: "conditional",
            when: (s) => s.represented === "yes",
            fields: ["represented", "agentName", "agentType", "agentIdType", "agentId", "agentPhone", "agentOrganization", "agentLicenseNo", "uploads:agent"],
            check: (s, up) => Boolean(s.agentName && s.agentType && s.agentId && s.agentPhone) && up.agent.length > 0,
            hint: "已选择委托代理人办理，需填写代理人姓名、身份，并上传授权委托书和代理人身份证明",
          },
        ],
      },

      /* ------------------------------------------------------------------
       * 03 被告线索辅助表（内部核对，不是平台独立必传栏目）
       * ---------------------------------------------------------------- */
      {
        id: "defendant",
        title: "被告线索辅助表",
        filename: "03_被告线索辅助表",
        sections: [
          {
            id: "defendant-info-source",
            title: "被告名称 / 地址的信息来源",
            step: 2,
            requirement: "optional",
            fields: ["defendantInfoSource"],
            hint: "写明名称、地址、证件号码来自何处（合同、送货单、转账记录、企业信用公示等），便于法院审查主体和送达",
          },
          {
            id: "defendant-extra-clues",
            title: "被告补充线索：证件号码、电话、实际经营地",
            step: 2,
            requirement: "optional",
            fields: ["defendantId", "defendantPhone", "defendantActualAddress"],
          },
        ],
      },

      /* ------------------------------------------------------------------
       * 04 证据目录
       * ---------------------------------------------------------------- */
      {
        id: "evidence",
        title: "证据目录",
        filename: "04_证据目录",
        sections: [
          {
            id: "evidence-list",
            title: "证据目录（至少一项）",
            step: 3,
            requirement: "required",
            fields: ["uploads:evidence", "evidence"],
            check: (s, up) =>
              s.evidence.length > 0 &&
              s.evidence.every((item) => {
                if (!item.name || !item.source || !item.purpose) return false;
                if (item.kind === "media")
                  return Boolean(item.mediaType && Number(item.fileCount) > 0);
                return up.evidence.some((file) => file.evidenceId === item.id);
              }),
            hint: "至少完成一项证据。图文证据应上传文件；影音证据需登记录音/视频类型和数量，并另行上传。",
          },
        ],
      },

      /* ------------------------------------------------------------------
       * 05 送达地址确认书
       * ---------------------------------------------------------------- */
      {
        id: "service",
        title: "送达地址确认书",
        filename: "05_送达地址确认书",
        sections: [
          {
            id: "service-info",
            title: "受送达人、送达地址、手机号码",
            step: 4,
            requirement: "required",
            fields: ["serviceRecipient", "serviceAddress", "servicePhone"],
            hint: "填写法院向你送达材料的地址和电话，需能长期稳定收件",
          },
          {
            id: "service-extra",
            title: "指定签收人、邮政编码、电子邮箱",
            step: 4,
            requirement: "optional",
            fields: ["serviceSigner", "servicePostcode", "serviceEmail"],
          },
          {
            id: "service-electronic",
            title: "电子送达方式选择",
            step: 4,
            requirement: "fixed",
            fields: ["electronicService"],
          },
        ],
      },
      /* ------------------------------------------------------------------
       * 06 收款账户确认书（平台选传）
       * ---------------------------------------------------------------- */
      {
        id: "refund",
        title: "收款账户确认书",
        filename: "06_收款账户确认书",
        sections: [
          {
            id: "refund-account-info",
            title: "收款账户名称、开户行、账号和联系电话",
            step: 4,
            requirement: "conditional",
            when: (s) => Boolean(s.includeRefundAccount),
            fields: [
              "includeRefundAccount",
              "refundAccountName",
              "refundBankName",
              "refundBankAccount",
              "refundPhone",
            ],
            requiredFields: [
              "refundAccountName",
              "refundBankName",
              "refundBankAccount",
              "refundPhone",
            ],
            hint: "法院平台标记为非必传；选择生成时需完整填写。",
          },
        ],
      },
    ],
  };

  global.JIUJIANG_CONTRACT = contract;
})(window);
