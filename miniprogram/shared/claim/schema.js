/* 从已验收的网页字段生成，运行 npm run generate-client 更新。 */
module.exports = {
  "defaults": {
    "court": "",
    "jurisdictionAgreement": "unknown",
    "arbitration": "unknown",
    "jurisdictionClause": "",
    "jurisdictionBases": [],
    "jurisdictionNote": "",
    "plaintiffType": "个人",
    "plaintiffName": "",
    "plaintiffGender": "",
    "plaintiffCountry": "中国",
    "plaintiffIdType": "居民身份证",
    "plaintiffLicenseType": "营业执照",
    "plaintiffId": "",
    "plaintiffPhone": "",
    "plaintiffAddress": "",
    "plaintiffRepresentative": "",
    "plaintiffRepresentativeTitle": "",
    "plaintiffRepresentativePhone": "",
    "identityMaterials": [
      {
        "id": "00000000-0000-4000-8000-000000000001",
        "name": "身份证"
      }
    ],
    "represented": "no",
    "agentName": "",
    "agentType": "律师",
    "agentIdType": "",
    "agentId": "",
    "agentPhone": "",
    "agentOrganization": "",
    "agentLicenseNo": "",
    "defendantType": "公司",
    "defendantName": "",
    "defendantGender": "",
    "defendantCountry": "中国",
    "defendantIdType": "",
    "defendantLicenseType": "营业执照",
    "defendantId": "",
    "defendantPhone": "",
    "defendantAddress": "",
    "defendantActualAddress": "",
    "defendantRepresentative": "",
    "defendantRepresentativePhone": "",
    "defendantInfoSource": "",
    "contractForm": "",
    "contractDate": "",
    "contractName": "",
    "dealFormation": "",
    "deliveryReceipt": "",
    "priceBasis": "",
    "debtAcknowledgement": "",
    "goods": "",
    "deliveryDate": "",
    "deliveryPlace": "",
    "deliveryDetails": "",
    "totalAmount": "",
    "paidAmount": "",
    "dueDate": "",
    "qualityDispute": "no",
    "paymentTerms": "",
    "qualityDetails": "",
    "demandHistory": "",
    "claimInterest": false,
    "interestTerms": "",
    "claimCosts": true,
    "claimAttorneyFee": false,
    "attorneyFeeTerms": "",
    "serviceRecipient": "",
    "serviceSigner": "",
    "serviceAddress": "",
    "servicePostcode": "",
    "servicePhone": "",
    "serviceEmail": "",
    "electronicService": "yes",
    "includeRefundAccount": false,
    "refundAccountName": "",
    "refundBankName": "",
    "refundBankAccount": "",
    "refundPhone": "",
    "evidence": [
      {
        "id": "00000000-0000-4000-8000-000000000002",
        "kind": "document",
        "name": "",
        "copyType": "复印件",
        "source": "原告提供",
        "purpose": "",
        "note": "",
        "mediaType": "",
        "fileCount": 0
      }
    ]
  },
  "sample": {
    "court": "九江市浔阳区人民法院",
    "jurisdictionAgreement": "no",
    "arbitration": "no",
    "jurisdictionClause": "",
    "jurisdictionBases": [
      "被告住所地或公司登记地在九江",
      "原告住所地在九江（货款为给付货币，接收货币一方所在地为合同履行地）",
      "合同履行地或交货地在九江"
    ],
    "jurisdictionNote": "被告登记地及实际经营地均位于九江市浔阳区，货物也交付至该经营场所。",
    "plaintiffType": "个体工商户",
    "plaintiffName": "浔阳区江畔百货商行",
    "plaintiffGender": "",
    "plaintiffCountry": "中国",
    "plaintiffIdType": "居民身份证",
    "plaintiffLicenseType": "营业执照",
    "plaintiffId": "92360403XXXXXXXXXX",
    "plaintiffPhone": "13800000000",
    "plaintiffAddress": "江西省九江市浔阳区示例路18号",
    "plaintiffRepresentative": "张三",
    "plaintiffRepresentativeTitle": "经营者",
    "plaintiffRepresentativePhone": "13800000000",
    "identityMaterials": [
      {
        "id": "00000000-0000-4000-8000-000000000003",
        "name": "营业执照"
      }
    ],
    "represented": "no",
    "agentName": "",
    "agentType": "律师",
    "agentIdType": "",
    "agentId": "",
    "agentPhone": "",
    "agentOrganization": "",
    "agentLicenseNo": "",
    "defendantType": "公司",
    "defendantName": "九江示例商贸有限公司",
    "defendantGender": "",
    "defendantCountry": "中国",
    "defendantIdType": "",
    "defendantLicenseType": "营业执照",
    "defendantId": "91360403XXXXXXXXXX",
    "defendantPhone": "13900000000",
    "defendantAddress": "江西省九江市浔阳区示例大道66号",
    "defendantActualAddress": "同注册地址",
    "defendantRepresentative": "李四",
    "defendantRepresentativePhone": "13900000000",
    "defendantInfoSource": "送货单、付款记录及国家企业信用信息公示系统",
    "contractForm": "无书面合同（送货单等）",
    "contractDate": "2026-03-02",
    "contractName": "",
    "dealFormation": "被告法定代表人李四于2026年3月2日通过微信向原告订购一批日用品，双方在微信中确认了品名、数量、单价及交货地点",
    "deliveryReceipt": "2026年3月12日送货单由被告仓库工作人员李某签字确认，送货单载明货物品名、数量、单价和总金额",
    "priceBasis": "以双方微信中确认的报价和送货单所列单价为依据，原告开具的发票金额与送货单金额一致",
    "debtAcknowledgement": "被告已支付18000元部分货款，并在后续催款微信中承认剩余货款尚未支付",
    "goods": "日用百货一批，品名及数量见送货单",
    "deliveryDate": "2026-03-12",
    "deliveryPlace": "九江市浔阳区示例大道66号被告仓库",
    "deliveryDetails": "原告按约将全部货物送至被告仓库，被告工作人员李某在送货单上签字确认，未在约定期限内提出质量或数量异议",
    "totalAmount": "58000",
    "paidAmount": "18000",
    "dueDate": "2026-04-15",
    "qualityDispute": "no",
    "paymentTerms": "收货并验收后30日内付清全部货款",
    "qualityDetails": "",
    "demandHistory": "2026年4月20日、5月8日和6月2日通过微信催款，被告法定代表人均回复资金周转困难并承诺尽快支付，但至今未付",
    "claimInterest": false,
    "interestTerms": "",
    "claimCosts": true,
    "claimAttorneyFee": false,
    "attorneyFeeTerms": "",
    "serviceRecipient": "张三",
    "serviceSigner": "张三",
    "serviceAddress": "江西省九江市浔阳区示例路18号",
    "servicePostcode": "332000",
    "servicePhone": "13800000000",
    "serviceEmail": "zhangsan@example.com",
    "electronicService": "yes",
    "includeRefundAccount": false,
    "refundAccountName": "",
    "refundBankName": "",
    "refundBankAccount": "",
    "refundPhone": "",
    "evidence": [
      {
        "id": "00000000-0000-4000-8000-000000000004",
        "kind": "document",
        "name": "微信订货及催款记录",
        "copyType": "复印件",
        "source": "原告提供",
        "purpose": "证明双方达成买卖交易、付款期限届满及被告承认欠款",
        "note": "",
        "mediaType": "",
        "fileCount": 0
      }
    ]
  },
  "steps": [
    {
      "index": 0,
      "title": "起诉状",
      "fields": [
        {
          "key": "plaintiffType",
          "label": "我是",
          "required": false,
          "placeholder": "",
          "kind": "select",
          "inputType": "text",
          "options": [
            {
              "value": "个人",
              "label": "个人"
            },
            {
              "value": "个体工商户",
              "label": "个体工商户"
            },
            {
              "value": "公司",
              "label": "公司"
            }
          ]
        },
        {
          "key": "plaintiffName",
          "label": "我的姓名或经营主体名称",
          "required": true,
          "placeholder": "与身份证或营业执照一致",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "plaintiffGender",
          "label": "性别",
          "required": true,
          "placeholder": "",
          "kind": "select",
          "inputType": "text",
          "options": [
            {
              "value": "",
              "label": "请选择"
            },
            {
              "value": "男",
              "label": "男"
            },
            {
              "value": "女",
              "label": "女"
            }
          ],
          "condition": "plaintiff-natural"
        },
        {
          "key": "plaintiffCountry",
          "label": "国别或地区",
          "required": true,
          "placeholder": "如：中国",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "plaintiffIdType",
          "label": "证件类型",
          "required": true,
          "placeholder": "",
          "kind": "select",
          "inputType": "text",
          "options": [
            {
              "value": "",
              "label": "请选择"
            },
            {
              "value": "居民身份证",
              "label": "居民身份证"
            },
            {
              "value": "护照",
              "label": "护照"
            },
            {
              "value": "港澳居民来往内地通行证",
              "label": "港澳居民来往内地通行证"
            },
            {
              "value": "台湾居民来往大陆通行证",
              "label": "台湾居民来往大陆通行证"
            },
            {
              "value": "其他",
              "label": "其他"
            }
          ],
          "condition": "plaintiff-natural"
        },
        {
          "key": "plaintiffLicenseType",
          "label": "证照类型",
          "required": true,
          "placeholder": "",
          "kind": "select",
          "inputType": "text",
          "options": [
            {
              "value": "",
              "label": "请选择"
            },
            {
              "value": "营业执照",
              "label": "营业执照"
            },
            {
              "value": "统一社会信用代码证书",
              "label": "统一社会信用代码证书"
            },
            {
              "value": "组织机构代码证",
              "label": "组织机构代码证"
            },
            {
              "value": "其他",
              "label": "其他"
            }
          ],
          "condition": "plaintiff-company"
        },
        {
          "key": "plaintiffId",
          "label": "身份证号 / 统一社会信用代码",
          "required": true,
          "placeholder": "",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "plaintiffPhone",
          "label": "联系电话",
          "required": true,
          "placeholder": "",
          "kind": "input",
          "inputType": "number"
        },
        {
          "key": "plaintiffAddress",
          "label": "住所地 / 注册地址",
          "required": true,
          "placeholder": "",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "plaintiffRepresentative",
          "label": "法定代表人 / 经营者",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "text",
          "condition": "plaintiff-company"
        },
        {
          "key": "plaintiffRepresentativeTitle",
          "label": "职务",
          "required": false,
          "placeholder": "如：执行董事、经营者",
          "kind": "input",
          "inputType": "text",
          "condition": "plaintiff-company"
        },
        {
          "key": "plaintiffRepresentativePhone",
          "label": "负责人手机号码",
          "required": true,
          "placeholder": "",
          "kind": "input",
          "inputType": "number",
          "condition": "plaintiff-company"
        },
        {
          "key": "defendantType",
          "label": "被告类型",
          "required": false,
          "placeholder": "",
          "kind": "select",
          "inputType": "text",
          "options": [
            {
              "value": "个人",
              "label": "个人"
            },
            {
              "value": "个体工商户",
              "label": "个体工商户"
            },
            {
              "value": "公司",
              "label": "公司"
            }
          ]
        },
        {
          "key": "defendantName",
          "label": "姓名或名称",
          "required": true,
          "placeholder": "尽量与身份证或营业执照一致",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "defendantGender",
          "label": "性别",
          "required": true,
          "placeholder": "",
          "kind": "select",
          "inputType": "text",
          "options": [
            {
              "value": "",
              "label": "请选择"
            },
            {
              "value": "男",
              "label": "男"
            },
            {
              "value": "女",
              "label": "女"
            },
            {
              "value": "不详",
              "label": "不详"
            }
          ],
          "condition": "defendant-natural"
        },
        {
          "key": "defendantCountry",
          "label": "国别或地区",
          "required": true,
          "placeholder": "如：中国",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "defendantIdType",
          "label": "证件类型",
          "required": false,
          "placeholder": "",
          "kind": "select",
          "inputType": "text",
          "options": [
            {
              "value": "",
              "label": "未知/不填"
            },
            {
              "value": "居民身份证",
              "label": "居民身份证"
            },
            {
              "value": "护照",
              "label": "护照"
            },
            {
              "value": "其他",
              "label": "其他"
            }
          ],
          "condition": "defendant-natural"
        },
        {
          "key": "defendantLicenseType",
          "label": "证照类型",
          "required": true,
          "placeholder": "",
          "kind": "select",
          "inputType": "text",
          "options": [
            {
              "value": "",
              "label": "请选择"
            },
            {
              "value": "营业执照",
              "label": "营业执照"
            },
            {
              "value": "统一社会信用代码证书",
              "label": "统一社会信用代码证书"
            },
            {
              "value": "组织机构代码证",
              "label": "组织机构代码证"
            },
            {
              "value": "其他",
              "label": "其他"
            }
          ],
          "condition": "defendant-company"
        },
        {
          "key": "defendantId",
          "label": "身份证号 / 统一社会信用代码",
          "required": false,
          "placeholder": "不知道可留空",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "defendantPhone",
          "label": "联系电话",
          "required": false,
          "placeholder": "不知道可留空",
          "kind": "input",
          "inputType": "number"
        },
        {
          "key": "defendantAddress",
          "label": "住所地 / 注册地址",
          "required": true,
          "placeholder": "",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "defendantActualAddress",
          "label": "实际经营或居住地址",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "defendantRepresentative",
          "label": "法定代表人 / 经营者",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "text",
          "condition": "defendant-company"
        },
        {
          "key": "defendantRepresentativePhone",
          "label": "负责人联系电话",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "number",
          "condition": "defendant-company"
        },
        {
          "key": "contractForm",
          "label": "我有没有书面买卖合同",
          "required": true,
          "placeholder": "",
          "kind": "select",
          "inputType": "text",
          "options": [
            {
              "value": "",
              "label": "请选择"
            },
            {
              "value": "书面买卖合同",
              "label": "书面买卖合同"
            },
            {
              "value": "无书面合同（送货单等）",
              "label": "无书面合同（送货单等）"
            },
            {
              "value": "微信/短信约定",
              "label": "微信/短信约定"
            },
            {
              "value": "订单或采购单",
              "label": "订单或采购单"
            },
            {
              "value": "电商平台订单",
              "label": "电商平台订单"
            },
            {
              "value": "口头约定",
              "label": "口头约定"
            },
            {
              "value": "多种凭据组合",
              "label": "多种凭据组合"
            }
          ]
        },
        {
          "key": "contractDate",
          "label": "合同或首次交易日期",
          "required": true,
          "placeholder": "",
          "kind": "date",
          "inputType": "text"
        },
        {
          "key": "contractName",
          "label": "合同名称/编号",
          "required": false,
          "placeholder": "有书面合同才需要填写",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "goods",
          "label": "货物名称及规格",
          "required": true,
          "placeholder": "",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "dealFormation",
          "label": "交易如何达成",
          "required": true,
          "placeholder": "",
          "kind": "textarea",
          "inputType": "text",
          "condition": "unwritten"
        },
        {
          "key": "deliveryReceipt",
          "label": "送货单及签收情况",
          "required": true,
          "placeholder": "",
          "kind": "textarea",
          "inputType": "text",
          "condition": "unwritten"
        },
        {
          "key": "priceBasis",
          "label": "价格和结算依据",
          "required": true,
          "placeholder": "",
          "kind": "textarea",
          "inputType": "text",
          "condition": "unwritten"
        },
        {
          "key": "debtAcknowledgement",
          "label": "对方承认交易或欠款的材料",
          "required": false,
          "placeholder": "",
          "kind": "textarea",
          "inputType": "text",
          "condition": "unwritten"
        },
        {
          "key": "deliveryDate",
          "label": "交货日期",
          "required": false,
          "placeholder": "",
          "kind": "date",
          "inputType": "text"
        },
        {
          "key": "deliveryPlace",
          "label": "交货地点",
          "required": true,
          "placeholder": "",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "deliveryDetails",
          "label": "交付、签收和验收情况",
          "required": true,
          "placeholder": "",
          "kind": "textarea",
          "inputType": "text"
        },
        {
          "key": "totalAmount",
          "label": "货款总额",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "digit"
        },
        {
          "key": "paidAmount",
          "label": "已付款",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "digit"
        },
        {
          "key": "dueDate",
          "label": "付款到期日",
          "required": true,
          "placeholder": "",
          "kind": "date",
          "inputType": "text"
        },
        {
          "key": "qualityDispute",
          "label": "是否存在质量/数量/退货争议",
          "required": false,
          "placeholder": "",
          "kind": "select",
          "inputType": "text",
          "options": [
            {
              "value": "no",
              "label": "没有"
            },
            {
              "value": "yes",
              "label": "有"
            },
            {
              "value": "unknown",
              "label": "不确定"
            }
          ]
        },
        {
          "key": "paymentTerms",
          "label": "付款约定",
          "required": false,
          "placeholder": "",
          "kind": "textarea",
          "inputType": "text"
        },
        {
          "key": "qualityDetails",
          "label": "争议或对方拒付理由",
          "required": false,
          "placeholder": "",
          "kind": "textarea",
          "inputType": "text"
        },
        {
          "key": "demandHistory",
          "label": "催款经过",
          "required": true,
          "placeholder": "",
          "kind": "textarea",
          "inputType": "text"
        },
        {
          "key": "claimInterest",
          "label": "同时主张逾期付款损失、利息或违约金",
          "required": false,
          "placeholder": "",
          "kind": "switch",
          "inputType": "text"
        },
        {
          "key": "interestTerms",
          "label": "逾期付款损失、利息或违约金的计算方式",
          "required": false,
          "placeholder": "",
          "kind": "textarea",
          "inputType": "text"
        },
        {
          "key": "claimCosts",
          "label": "请求被告承担本案诉讼费用",
          "required": false,
          "placeholder": "",
          "kind": "switch",
          "inputType": "text"
        },
        {
          "key": "claimAttorneyFee",
          "label": "请求承担律师费等实现债权费用",
          "required": false,
          "placeholder": "",
          "kind": "switch",
          "inputType": "text"
        },
        {
          "key": "attorneyFeeTerms",
          "label": "实现债权费用及依据",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "court",
          "label": "九江辖区基层法院",
          "required": true,
          "placeholder": "",
          "kind": "select",
          "inputType": "text",
          "options": [
            {
              "value": "",
              "label": "请选择"
            },
            {
              "value": "九江市浔阳区人民法院",
              "label": "九江市浔阳区人民法院"
            },
            {
              "value": "九江市濂溪区人民法院",
              "label": "九江市濂溪区人民法院"
            },
            {
              "value": "九江市柴桑区人民法院",
              "label": "九江市柴桑区人民法院"
            },
            {
              "value": "九江经济技术开发区人民法院",
              "label": "九江经济技术开发区人民法院"
            },
            {
              "value": "瑞昌市人民法院",
              "label": "瑞昌市人民法院"
            },
            {
              "value": "共青城市人民法院",
              "label": "共青城市人民法院"
            },
            {
              "value": "庐山市人民法院",
              "label": "庐山市人民法院"
            },
            {
              "value": "武宁县人民法院",
              "label": "武宁县人民法院"
            },
            {
              "value": "修水县人民法院",
              "label": "修水县人民法院"
            },
            {
              "value": "永修县人民法院",
              "label": "永修县人民法院"
            },
            {
              "value": "德安县人民法院",
              "label": "德安县人民法院"
            },
            {
              "value": "都昌县人民法院",
              "label": "都昌县人民法院"
            },
            {
              "value": "湖口县人民法院",
              "label": "湖口县人民法院"
            },
            {
              "value": "彭泽县人民法院",
              "label": "彭泽县人民法院"
            }
          ]
        },
        {
          "key": "jurisdictionAgreement",
          "label": "书面合同是否约定管辖法院",
          "required": false,
          "placeholder": "",
          "kind": "select",
          "inputType": "text",
          "options": [
            {
              "value": "unknown",
              "label": "不确定"
            },
            {
              "value": "no",
              "label": "没有"
            },
            {
              "value": "yes",
              "label": "有"
            }
          ],
          "condition": "written"
        },
        {
          "key": "arbitration",
          "label": "你是否签过书面仲裁约定",
          "required": false,
          "placeholder": "",
          "kind": "select",
          "inputType": "text",
          "options": [
            {
              "value": "unknown",
              "label": "不确定"
            },
            {
              "value": "no",
              "label": "没有"
            },
            {
              "value": "yes",
              "label": "有"
            }
          ]
        },
        {
          "key": "jurisdictionClause",
          "label": "书面合同中的管辖约定",
          "required": false,
          "placeholder": "",
          "kind": "textarea",
          "inputType": "text",
          "condition": "written"
        },
        {
          "key": "jurisdictionNote",
          "label": "管辖补充说明",
          "required": false,
          "placeholder": "",
          "kind": "textarea",
          "inputType": "text"
        }
      ]
    },
    {
      "index": 1,
      "title": "当事人身份证明",
      "fields": [
        {
          "key": "plaintiffType",
          "label": "主体类型",
          "required": false,
          "placeholder": "",
          "kind": "select",
          "inputType": "text",
          "options": [
            {
              "value": "个人",
              "label": "个人"
            },
            {
              "value": "个体工商户",
              "label": "个体工商户"
            },
            {
              "value": "公司",
              "label": "公司"
            }
          ]
        },
        {
          "key": "plaintiffName",
          "label": "姓名或经营主体名称",
          "required": true,
          "placeholder": "",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "plaintiffGender",
          "label": "性别",
          "required": true,
          "placeholder": "",
          "kind": "select",
          "inputType": "text",
          "options": [
            {
              "value": "",
              "label": "请选择"
            },
            {
              "value": "男",
              "label": "男"
            },
            {
              "value": "女",
              "label": "女"
            }
          ],
          "condition": "plaintiff-natural"
        },
        {
          "key": "plaintiffCountry",
          "label": "国别或地区",
          "required": true,
          "placeholder": "",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "plaintiffIdType",
          "label": "证件类型",
          "required": true,
          "placeholder": "",
          "kind": "select",
          "inputType": "text",
          "options": [
            {
              "value": "",
              "label": "请选择"
            },
            {
              "value": "居民身份证",
              "label": "居民身份证"
            },
            {
              "value": "护照",
              "label": "护照"
            },
            {
              "value": "港澳居民来往内地通行证",
              "label": "港澳居民来往内地通行证"
            },
            {
              "value": "台湾居民来往大陆通行证",
              "label": "台湾居民来往大陆通行证"
            },
            {
              "value": "其他",
              "label": "其他"
            }
          ],
          "condition": "plaintiff-natural"
        },
        {
          "key": "plaintiffLicenseType",
          "label": "证照类型",
          "required": true,
          "placeholder": "",
          "kind": "select",
          "inputType": "text",
          "options": [
            {
              "value": "",
              "label": "请选择"
            },
            {
              "value": "营业执照",
              "label": "营业执照"
            },
            {
              "value": "统一社会信用代码证书",
              "label": "统一社会信用代码证书"
            },
            {
              "value": "组织机构代码证",
              "label": "组织机构代码证"
            },
            {
              "value": "其他",
              "label": "其他"
            }
          ],
          "condition": "plaintiff-company"
        },
        {
          "key": "plaintiffId",
          "label": "身份证号 / 统一社会信用代码",
          "required": true,
          "placeholder": "",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "plaintiffPhone",
          "label": "联系电话",
          "required": true,
          "placeholder": "",
          "kind": "input",
          "inputType": "number"
        },
        {
          "key": "plaintiffAddress",
          "label": "住所地 / 注册地址",
          "required": true,
          "placeholder": "",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "plaintiffRepresentative",
          "label": "法定代表人 / 经营者",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "text",
          "condition": "plaintiff-company"
        },
        {
          "key": "plaintiffRepresentativeTitle",
          "label": "职务",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "text",
          "condition": "plaintiff-company"
        },
        {
          "key": "plaintiffRepresentativePhone",
          "label": "负责人手机号码",
          "required": true,
          "placeholder": "",
          "kind": "input",
          "inputType": "number",
          "condition": "plaintiff-company"
        },
        {
          "key": "represented",
          "label": "这次起诉由谁办理",
          "required": false,
          "placeholder": "",
          "kind": "select",
          "inputType": "text",
          "options": [
            {
              "value": "no",
              "label": "我本人 / 本单位自行办理"
            },
            {
              "value": "yes",
              "label": "委托代理人办理"
            }
          ]
        },
        {
          "key": "agentName",
          "label": "代理人姓名",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "text",
          "condition": "agent"
        },
        {
          "key": "agentType",
          "label": "代理人身份",
          "required": false,
          "placeholder": "",
          "kind": "select",
          "inputType": "text",
          "options": [
            {
              "value": "律师",
              "label": "律师"
            },
            {
              "value": "近亲属",
              "label": "近亲属"
            },
            {
              "value": "本单位员工",
              "label": "本单位员工"
            },
            {
              "value": "其他符合条件的代理人",
              "label": "其他符合条件的代理人"
            }
          ],
          "condition": "agent"
        },
        {
          "key": "agentIdType",
          "label": "代理人证件类型",
          "required": false,
          "placeholder": "",
          "kind": "select",
          "inputType": "text",
          "options": [
            {
              "value": "",
              "label": "请选择"
            },
            {
              "value": "居民身份证",
              "label": "居民身份证"
            },
            {
              "value": "律师执业证",
              "label": "律师执业证"
            },
            {
              "value": "其他",
              "label": "其他"
            }
          ],
          "condition": "agent"
        },
        {
          "key": "agentId",
          "label": "代理人证件号码",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "text",
          "condition": "agent"
        },
        {
          "key": "agentPhone",
          "label": "联系电话",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "number",
          "condition": "agent"
        },
        {
          "key": "agentOrganization",
          "label": "单位",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "text",
          "condition": "agent"
        },
        {
          "key": "agentLicenseNo",
          "label": "执业证号（律师填写）",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "text",
          "condition": "agent"
        }
      ]
    },
    {
      "index": 2,
      "title": "被告线索（辅助）",
      "fields": [
        {
          "key": "defendantType",
          "label": "被告类型",
          "required": false,
          "placeholder": "",
          "kind": "select",
          "inputType": "text",
          "options": [
            {
              "value": "个人",
              "label": "个人"
            },
            {
              "value": "个体工商户",
              "label": "个体工商户"
            },
            {
              "value": "公司",
              "label": "公司"
            }
          ]
        },
        {
          "key": "defendantName",
          "label": "姓名或名称",
          "required": true,
          "placeholder": "",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "defendantGender",
          "label": "性别",
          "required": true,
          "placeholder": "",
          "kind": "select",
          "inputType": "text",
          "options": [
            {
              "value": "",
              "label": "请选择"
            },
            {
              "value": "男",
              "label": "男"
            },
            {
              "value": "女",
              "label": "女"
            },
            {
              "value": "不详",
              "label": "不详"
            }
          ],
          "condition": "defendant-natural"
        },
        {
          "key": "defendantCountry",
          "label": "国别或地区",
          "required": true,
          "placeholder": "",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "defendantIdType",
          "label": "证件类型",
          "required": false,
          "placeholder": "",
          "kind": "select",
          "inputType": "text",
          "options": [
            {
              "value": "",
              "label": "未知/不填"
            },
            {
              "value": "居民身份证",
              "label": "居民身份证"
            },
            {
              "value": "护照",
              "label": "护照"
            },
            {
              "value": "其他",
              "label": "其他"
            }
          ],
          "condition": "defendant-natural"
        },
        {
          "key": "defendantLicenseType",
          "label": "证照类型",
          "required": true,
          "placeholder": "",
          "kind": "select",
          "inputType": "text",
          "options": [
            {
              "value": "",
              "label": "请选择"
            },
            {
              "value": "营业执照",
              "label": "营业执照"
            },
            {
              "value": "统一社会信用代码证书",
              "label": "统一社会信用代码证书"
            },
            {
              "value": "组织机构代码证",
              "label": "组织机构代码证"
            },
            {
              "value": "其他",
              "label": "其他"
            }
          ],
          "condition": "defendant-company"
        },
        {
          "key": "defendantId",
          "label": "身份证号 / 统一社会信用代码",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "defendantPhone",
          "label": "联系电话",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "number"
        },
        {
          "key": "defendantAddress",
          "label": "住所地 / 注册地址",
          "required": true,
          "placeholder": "",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "defendantActualAddress",
          "label": "实际经营或居住地址",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "defendantRepresentative",
          "label": "法定代表人 / 经营者",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "text",
          "condition": "defendant-company"
        },
        {
          "key": "defendantRepresentativePhone",
          "label": "负责人联系电话",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "number",
          "condition": "defendant-company"
        },
        {
          "key": "defendantInfoSource",
          "label": "这些信息从哪里找到的",
          "required": false,
          "placeholder": "送货单、付款记录、企业信用公示等",
          "kind": "input",
          "inputType": "text"
        }
      ]
    },
    {
      "index": 3,
      "title": "证据目录",
      "fields": [
        {
          "key": "plaintiffName",
          "label": "原告名称",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "defendantName",
          "label": "被告名称",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "text"
        }
      ]
    },
    {
      "index": 4,
      "title": "送达确认和收款账户",
      "fields": [
        {
          "key": "court",
          "label": "提交法院",
          "required": false,
          "placeholder": "",
          "kind": "select",
          "inputType": "text",
          "options": [
            {
              "value": "",
              "label": "请选择"
            },
            {
              "value": "九江市浔阳区人民法院",
              "label": "九江市浔阳区人民法院"
            },
            {
              "value": "九江市濂溪区人民法院",
              "label": "九江市濂溪区人民法院"
            },
            {
              "value": "九江市柴桑区人民法院",
              "label": "九江市柴桑区人民法院"
            },
            {
              "value": "九江经济技术开发区人民法院",
              "label": "九江经济技术开发区人民法院"
            },
            {
              "value": "瑞昌市人民法院",
              "label": "瑞昌市人民法院"
            },
            {
              "value": "共青城市人民法院",
              "label": "共青城市人民法院"
            },
            {
              "value": "庐山市人民法院",
              "label": "庐山市人民法院"
            },
            {
              "value": "武宁县人民法院",
              "label": "武宁县人民法院"
            },
            {
              "value": "修水县人民法院",
              "label": "修水县人民法院"
            },
            {
              "value": "永修县人民法院",
              "label": "永修县人民法院"
            },
            {
              "value": "德安县人民法院",
              "label": "德安县人民法院"
            },
            {
              "value": "都昌县人民法院",
              "label": "都昌县人民法院"
            },
            {
              "value": "湖口县人民法院",
              "label": "湖口县人民法院"
            },
            {
              "value": "彭泽县人民法院",
              "label": "彭泽县人民法院"
            }
          ]
        },
        {
          "key": "plaintiffName",
          "label": "原告名称",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "plaintiffId",
          "label": "身份证号 / 统一社会信用代码",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "serviceRecipient",
          "label": "受送达人",
          "required": true,
          "placeholder": "",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "serviceSigner",
          "label": "指定签收人",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "serviceAddress",
          "label": "确认送达地址",
          "required": true,
          "placeholder": "",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "servicePostcode",
          "label": "邮政编码",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "servicePhone",
          "label": "手机号码",
          "required": true,
          "placeholder": "",
          "kind": "input",
          "inputType": "number"
        },
        {
          "key": "serviceEmail",
          "label": "电子邮箱",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "text"
        },
        {
          "key": "electronicService",
          "label": "是否同意电子送达",
          "required": false,
          "placeholder": "",
          "kind": "select",
          "inputType": "text",
          "options": [
            {
              "value": "yes",
              "label": "同意"
            },
            {
              "value": "no",
              "label": "不同意"
            },
            {
              "value": "unsure",
              "label": "暂不确定"
            }
          ]
        },
        {
          "key": "includeRefundAccount",
          "label": "一并生成收款/退费账户确认书",
          "required": false,
          "placeholder": "",
          "kind": "switch",
          "inputType": "text"
        },
        {
          "key": "refundAccountName",
          "label": "账户名称",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "text",
          "condition": "refund"
        },
        {
          "key": "refundBankName",
          "label": "开户银行",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "text",
          "condition": "refund"
        },
        {
          "key": "refundBankAccount",
          "label": "银行账号",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "text",
          "condition": "refund"
        },
        {
          "key": "refundPhone",
          "label": "联系电话",
          "required": false,
          "placeholder": "",
          "kind": "input",
          "inputType": "number",
          "condition": "refund"
        }
      ]
    },
    {
      "index": 5,
      "title": "检查下载",
      "fields": []
    }
  ],
  "courts": [
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
    "彭泽县人民法院"
  ],
  "grounds": [
    {
      "value": "被告住所地或公司登记地在九江",
      "label": "被告住所地/登记地在九江",
      "writtenOnly": false
    },
    {
      "value": "原告住所地在九江（货款为给付货币，接收货币一方所在地为合同履行地）",
      "label": "原告住所地（收款方）在九江",
      "writtenOnly": false
    },
    {
      "value": "合同履行地或交货地在九江",
      "label": "合同履行地/交货地在九江",
      "writtenOnly": false
    },
    {
      "value": "合同约定由九江辖区法院管辖",
      "label": "书面合同约定九江法院管辖",
      "writtenOnly": true
    },
    {
      "value": "其他与九江有关的连接点",
      "label": "其他九江连接点",
      "writtenOnly": false
    }
  ]
};
