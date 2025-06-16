import redis from "./dist/redisClient.js"; // make sure this connects to your redis

const index = "agreements"; 
const userId = "testuser"; 

const queryBody = {
    "query": {
      "bool": {
        "should": [
          {
            "term": {
              "CREATED_BY_ID.keyword": "eb8fd3be-2d64-4b53-b806-75fd120862f7"
            }
          },
          {
            "term": {
              "OWNER_ID.keyword": "eb8fd3be-2d64-4b53-b806-75fd120862f7"
            }
          },
          {
            "term": {
              "UPDATED_BY_ID.keyword": "eb8fd3be-2d64-4b53-b806-75fd120862f7"
            }
          }
        ],
        "minimum_should_match": 1
      }
    },
    "sort": [
      {
        "CREATED_ON": {
          "order": "desc"
        }
      }
    ],
    "size": 20,
    "_source": [
      "AGREEMENT_ID",
      "DISPLAY_ID",
      "DISPLAY_NAME",
      "CREATED_ON",
      "UPDATED_ON",
      "CREATED_BY_ID",
      "OWNER_ID",
      "UPDATED_BY_ID",
      "STATUS",
      "AGREEMENT_TYPE_NAME",
      "AGREEMENT_CATEGORY_NAME",
      "USER_FIRSTNAME",
      "USER_LASTNAME",
      "SAP_NUMBER",
      "CONTRACT_TYPE"
    ]
  }


async function main() {
    
    const redisKey = `GLOBAL_SEARCH_INDEX_ID_MAPPING:${userId}`;
    const jsonString = await redis.get(redisKey);

    const allowedIdsObj = {'header_section_doc_ids': ['eb8fd3be-2d64-4b53-b806-75fd120862f7_1',
        'eb8fd3be-2d64-4b53-b806-75fd120862f7_2',
        'eb8fd3be-2d64-4b53-b806-75fd120862f7_3',
        'eb8fd3be-2d64-4b53-b806-75fd120862f7_4',
        'eb8fd3be-2d64-4b53-b806-75fd120862f7_5',
        'eb8fd3be-2d64-4b53-b806-75fd120862f7_6',
        'eb8fd3be-2d64-4b53-b806-75fd120862f7_7',
        'eb8fd3be-2d64-4b53-b806-75fd120862f7_8'],
       'line_item_section_doc_ids': ['eb8fd3be-2d64-4b53-b806-75fd120862f7_1',
        'eb8fd3be-2d64-4b53-b806-75fd120862f7_2',
        'eb8fd3be-2d64-4b53-b806-75fd120862f7_3',
        'eb8fd3be-2d64-4b53-b806-75fd120862f7_4',
        'eb8fd3be-2d64-4b53-b806-75fd120862f7_5'],
       'header_clause_doc_ids': ['eb8fd3be-2d64-4b53-b806-75fd120862f7_1',
        'eb8fd3be-2d64-4b53-b806-75fd120862f7_2'],
       'line_item_clause_doc_ids': ['eb8fd3be-2d64-4b53-b806-75fd120862f7_1',
        'eb8fd3be-2d64-4b53-b806-75fd120862f7_2'],
       'attachment_doc_ids': ['eb8fd3be-2d64-4b53-b806-75fd120862f7_1'],
       'meta_doc_ids': ['eb8fd3be-2d64-4b53-b806-75fd120862f7_1',
        'eb8fd3be-2d64-4b53-b806-75fd120862f7_2']}
  
    const allowedIds = [
      ...allowedIdsObj.header_section_doc_ids,
      ...allowedIdsObj.line_item_section_doc_ids,
      ...allowedIdsObj.header_clause_doc_ids,
      ...allowedIdsObj.line_item_clause_doc_ids,
      ...allowedIdsObj.attachment_doc_ids,
      ...allowedIdsObj.meta_doc_ids,
    ];
  
    let permissionFilter;
  
    if (index === "cdc_field_data_agreement" || index === "lineitems") {
      const sectionPermKey = `SECTION_PERMISSIONS:${userId}`;
      const allowedSectionPairs = JSON.parse(await redis.get(sectionPermKey) || "[]");
  
      if (allowedSectionPairs.length > 0) {
        permissionFilter = {
          bool: {
            should: allowedSectionPairs.map((pair) => ({
              bool: {
                must: [
                  { term: { "AGREEMENT_ID.keyword": pair.agreement_id } },
                  { term: { "SECTION_ID.keyword": pair.section_id } }
                ]
              }
            }))
          }
        };
      } else {
        permissionFilter = {
          term: { "AGREEMENT_ID.keyword": "__none__" }
        };
      }
    } else {
      permissionFilter = {
        terms: {
          "AGREEMENT_ID.keyword": allowedIds.length > 0 ? allowedIds : ["__none__"],
        },
      };
    }
  
    if (!queryBody.query) {
      queryBody.query = {
        bool: {
          filter: [permissionFilter],
        }
      };
    } else if (queryBody.query.bool) {
      if (!queryBody.query.bool.filter) {
        queryBody.query.bool.filter = [];
      }
      queryBody.query.bool.filter.push(permissionFilter);
    } else {
      const originalQuery = queryBody.query;
      queryBody.query = {
        bool: {
          must: [originalQuery],
          filter: [permissionFilter],
        }
      };
    }
  
    console.log(JSON.stringify({ index, body: queryBody }, null, 2));
  }
  
  main().catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });