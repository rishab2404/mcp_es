const index = "cdc_field_data_agreement"; 

const allowedIdsObj = {
  "header_section_doc_ids": [
    "30fc609b-a797-4a67-b601-9e1a784be701_1",
    "30fc609b-a797-4a67-b601-9e1a784be701_2",
    "30fc609b-a797-4a67-b601-9e1a784be701_3",
    "30fc609b-a797-4a67-b601-9e1a784be701_4",
    "30fc609b-a797-4a67-b601-9e1a784be701_5",
    "30fc609b-a797-4a67-b601-9e1a784be701_6",
    "30fc609b-a797-4a67-b601-9e1a784be701_7",
    "30fc609b-a797-4a67-b601-9e1a784be701_8",
    "30fc609b-a797-4a67-b601-9e1a784be701_9",
    "30fc609b-a797-4a67-b601-9e1a784be701_10"
  ],
  "line_item_section_doc_ids": [
    "30fc609b-a797-4a67-b601-9e1a784be701_1",
    "30fc609b-a797-4a67-b601-9e1a784be701_2",
    "30fc609b-a797-4a67-b601-9e1a784be701_3",
    "30fc609b-a797-4a67-b601-9e1a784be701_4",
    "30fc609b-a797-4a67-b601-9e1a784be701_5"
  ],
  "header_clause_doc_ids": [
    "30fc609b-a797-4a67-b601-9e1a784be701_1",
    "30fc609b-a797-4a67-b601-9e1a784be701_2"
  ],
  "line_item_clause_doc_ids": [
    "30fc609b-a797-4a67-b601-9e1a784be701_1",
    "30fc609b-a797-4a67-b601-9e1a784be701_2"
  ],
  "attachment_doc_ids": [
    "30fc609b-a797-4a67-b601-9e1a784be701_1",
    "30fc609b-a797-4a67-b601-9e1a784be701_2"
  ],
  "meta_doc_ids": [
    "30fc609b-a797-4a67-b601-9e1a784be701_1",
    "30fc609b-a797-4a67-b601-9e1a784be701_2"
  ]
};

const testCases = [
  {
    label: "No query at all — basic fallback",
    baseQuery: {
      from: 0,
      size: 3,
      sort: [{ "EFFECTIVE_DATE": "desc" }]
    }
  },
  {
    label: "Single fuzzy query",
    baseQuery: {
      query: {
        fuzzy: {
          "OWNER_NAME": {
            value: "johnsen",
            fuzziness: 2,
            prefix_length: 1
          }
        }
      },
      highlight: {
        fields: {
          "OWNER_NAME": {}
        }
      },
      size: 5
    }
  },
  {
    label: "Bool query with should but no must",
    baseQuery: {
      query: {
        bool: {
          should: [
            {
              wildcard: {
                "AGREEMENT_DISPLAY_ID.keyword": {
                  value: "FA*",
                  boost: 1.5
                }
              }
            },
            {
              match: {
                "AGREEMENT_NAME": {
                  query: "Framework",
                  fuzziness: "AUTO"
                }
              }
            }
          ],
          minimum_should_match: 1
        }
      },
      from: 0,
      size: 10,
      aggs: {
        by_status: {
          terms: {
            field: "STATUS.keyword"
          }
        }
      }
    }
  },
  {
    label: "Full bool query with all clauses, highlight, and aggs",
    baseQuery: {
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query: "contract renewal",
                fields: ["AGREEMENT_NAME", "DESCRIPTION"],
                fuzziness: "AUTO"
              }
            },
            {
              range: {
                EFFECTIVE_DATE: {
                  gte: "2022-01-01",
                  lte: "2023-12-31"
                }
              }
            }
          ],
          must_not: [
            {
              term: {
                "IS_ARCHIVED": true
              }
            }
          ],
          filter: [
            {
              term: {
                "IS_APPROVED": true
              }
            }
          ],
          should: [
            {
              match: {
                "CATEGORY": "Supply"
              }
            }
          ]
        }
      },
      highlight: {
        fields: {
          "*": {
            max_analyzed_offset: 100000
          }
        }
      },
      aggs: {
        date_histogram: {
          date_histogram: {
            field: "EFFECTIVE_DATE",
            calendar_interval: "month"
          }
        }
      },
      from: 5,
      size: 20
    }
  },
  {
    label: "Query with only filters, script_score, and nested aggs",
    baseQuery: {
      query: {
        function_score: {
          query: {
            bool: {
              filter: [
                {
                  term: {
                    "IS_ACTIVE": true
                  }
                },
                {
                  range: {
                    "EFFECTIVE_DATE": {
                      gte: "2023-01-01"
                    }
                  }
                }
              ]
            }
          },
          script_score: {
            script: {
              source: "doc['EFFECTIVE_DATE'].value.toInstant().toEpochMilli()"
            }
          }
        }
      },
      aggs: {
        agreements_per_owner: {
          terms: {
            field: "OWNER_NAME.keyword"
          },
          aggs: {
            top_hit: {
              top_hits: {
                size: 1,
                sort: [{ EFFECTIVE_DATE: "desc" }]
              }
            }
          }
        }
      },
      size: 10
    }
  }
];


// const baseQuery = {
//   query: {
//     match_all: {}
//   },
//   from: 0,
//   size: 10
// };

// const baseQuery ={
//   size: 0,
//   aggs: {
//     agreements_over_time: {
//       date_histogram: {
//         field: "EFFECTIVE_DATE",
//         calendar_interval: "month"
//       }
//     },
//     top_owners: {
//       terms: {
//         field: "OWNER_NAME.keyword",
//         size: 5
//       },
//       aggs: {
//         avg_value: {
//           avg: {
//             field: "AGREEMENT_VALUE"
//           }
//         }
//       }
//     }
//   }
// };

const baseQuery = {
  "index": "cdc_agreement_list",
  "queryBody": {
    "size": 10,
    "query": {
      "match_all": {}
    },
    "from": 0
  },
  "userId": "30fc609b-a797-4a67-b601-9e1a784be701"
};



// ----- Modular Permission Injection -----

function buildPermissionFilter(index, ids) {
  switch (index) {
    case "cdc_agreement_list":
      return {
        bool: {
          should: ids.meta_doc_ids.map(id => ({
            terms: {
              "AGREEMENT_ID.keyword": {
                index: "permitted_agreement_for_meta",
                id,
                path: "agreement_ids"
              }
            }
          }))
        }
      };
    case "cms_documents":
      return {
        bool: {
          should: ids.attachment_doc_ids.map(id => ({
            terms: {
              "AGREEMENT_ID.keyword": {
                index: "permitted_agreement_for_attachment",
                id,
                path: "agreement_ids"
              }
            }
          }))
        }
      };
    case "cdc_line_items":
      return {
        bool: {
          should: ids.line_item_section_doc_ids.map(id => ({
            bool: {
              must: [
                {
                  terms: {
                    "AGREEMENT_ID.keyword": {
                      index: "permitted_line_item_section",
                      id,
                      path: "sections.agreement_id"
                    }
                  }
                },
                {
                  terms: {
                    "SECTION_ID.keyword": {
                      index: "permitted_line_item_section",
                      id,
                      path: "sections.section_id"
                    }
                  }
                }
              ]
            }
          }))
        }
      };
    case "cdc_field_data_agreement":
      return {
        bool: {
          should: ids.header_section_doc_ids.map(id => ({
            bool: {
              must: [
                {
                  terms: {
                    "AGREEMENT_ID.keyword": {
                      index: "permitted_header_section",
                      id,
                      path: "sections.agreement_id"
                    }
                  }
                },
                {
                  terms: {
                    "SECTION_ID.keyword": {
                      index: "permitted_header_section",
                      id,
                      path: "sections.section_id"
                    }
                  }
                }
              ]
            }
          }))
        }
      };
    case "cdc_clauses_data":
      return {
        bool: {
          should: ids.header_clause_doc_ids.map(id => ({
            terms: {
              "AGREEMENT_ID.keyword": {
                index: "permitted_agreement_for_clause",
                id,
                path: "agreement_ids"
              }
            }
          }))
        }
      };
    default:
      return {
        terms: {
          "AGREEMENT_ID.keyword": [
            ...ids.header_section_doc_ids,
            ...ids.line_item_section_doc_ids,
            ...ids.header_clause_doc_ids,
            ...ids.line_item_clause_doc_ids,
            ...ids.attachment_doc_ids,
            ...ids.meta_doc_ids
          ]
        }
      };
  }
}

function injectPermissions(query, permissionFilter) {
  if (!query.query) {
    query.query = {
      bool: {
        must: [permissionFilter]
      }
    };
  } else if (query.query.bool) {
    if (!query.query.bool.must) {
      query.query.bool.must = [];
    }
    query.query.bool.must.push(permissionFilter);
  } else {
    const originalQuery = query.query;
    query.query = {
      bool: {
        must: [originalQuery, permissionFilter]
      }
    };
  }
}

// testCases.forEach(({ label, baseQuery }) => {
//   const clonedQuery = JSON.parse(JSON.stringify(baseQuery));
//   const permissionFilter = buildPermissionFilter("cdc_field_data_agreement", allowedIdsObj);
//   injectPermissions(clonedQuery, permissionFilter);

//   console.log(`\n\n🔍 Final query with injected permissions for case: ${label}`);
//   console.log(JSON.stringify(clonedQuery, null, 2));
// });


// ----- Run Injection -----
const permissionFilter = buildPermissionFilter(baseQuery.index, allowedIdsObj);
injectPermissions(baseQuery.queryBody, permissionFilter);

console.log("🔍 Final query with injected permissions for:", index);
console.log(JSON.stringify(baseQuery, null, 2));




