/*
 * ForwardWidgets module for fetching Bilibili danmaku (bullet comments).
 *
 * This script implements three modules that integrate with the ForwardWidgets
 * ecosystem. You can search for videos on Bilibili, retrieve the list of
 * pages (CIDs) for a given video, and fetch danmaku for a specific CID.
 *
 * The APIs used here are publicly documented: searching videos uses the
 * `x/web-interface/search/type` endpoint, retrieving CIDs uses
 * `x/player/pagelist`, and danmaku is pulled from the legacy XML endpoint
 * `https://comment.bilibili.com/{cid}.xml`. The XML is parsed into an
 * array of objects with appearance time, type, font size, color, timestamp,
 * pool, user hash, danmaku ID and content. See SocialSisterYi's API
 * collection for details on the structure of the `p` attribute【680846519515360†L148-L174】.
 */

/* global Widget */

// Define widget metadata.
global.WidgetMetadata = {
  id: 'forward.biliDanmu',
  title: 'bilibiliDanmu',
  version: '1.0.0',
  description: '搜索B站视频并获取其弹幕',
  author: 'Avalon',
  requiredVersion: '1.0.0',
  globalParams: [],
  modules: [
    {
      id: 'searchVideo',
      title: '搜索视频',
      functionName: 'searchVideo',
      type: 'search',
      params: [
        {
          id: 'keyword',
          name: '关键词',
          type: 'string',
          required: true,
          default: ''
        },
        {
          id: 'page',
          name: '页码',
          type: 'number',
          required: false,
          default: 1
        }
      ]
    },
    {
      id: 'getCidList',
      title: '获取CID列表',
      functionName: 'getCidList',
      type: 'getDetail',
      params: [
        {
          id: 'bvId',
          name: 'BV号或AV号',
          type: 'string',
          required: true,
          default: ''
        }
      ]
    },
    {
      id: 'getComments',
      title: '获取弹幕',
      functionName: 'getComments',
      type: 'getComments',
      params: [
        {
          id: 'cid',
          name: 'CID',
          type: 'number',
          required: true,
          default: 0
        }
      ]
    }
  ]
};

/**
 * 搜索B站视频。
 *
 * @param {string} keyword 搜索关键词
 * @param {number} page 页码（可选）
 * @returns {Promise<Array>} 搜索结果，数组元素包含 id、title、cover、desc
 */
async function searchVideo(keyword, page = 1) {
  const searchUrl = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(keyword)}&page=${page}`;
  const res = await Widget.http.get(searchUrl, {
    headers: {
      // Provide a generic User-Agent to avoid being blocked
      'User-Agent': 'Mozilla/5.0 (ForwardWidgets)'
    }
  });

  const data = res.data;
  if (!data || data.code !== 0) {
    throw new Error(`搜索接口返回错误：${data ? data.message : '未知错误'}`);
  }
  const list = data.data?.result || [];
  // Map results to the required format
  return list.map(item => {
    return {
      id: item.bvid || item.aid || '',
      title: String(item.title || '').replace(/<[^>]+>/g, ''),
      cover: item.pic || '',
      desc: item.description || ''
    };
  });
}

/**
 * 获取视频的页列表（CID列表）。
 *
 * @param {string} bvId 视频的BV号或AV号
 * @returns {Promise<Array>} 每页包含 cid、page、name 等信息
 */
async function getCidList(bvId) {
  if (!bvId) throw new Error('必须提供BV号或AV号');
  // Determine whether it is a BV or AV id and call the appropriate parameter
  let url;
  if (/^BV/i.test(bvId)) {
    url = `https://api.bilibili.com/x/player/pagelist?bvid=${bvId}`;
  } else {
    url = `https://api.bilibili.com/x/player/pagelist?aid=${bvId}`;
  }
  const res = await Widget.http.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (ForwardWidgets)'
    }
  });
  const data = res.data;
  if (!data || data.code !== 0) {
    throw new Error(`获取CID列表失败：${data ? data.message : '未知错误'}`);
  }
  const pages = data.data || [];
  return pages.map(page => {
    return {
      cid: page.cid,
      page: page.page,
      name: page.part
    };
  });
}

/**
 * 获取指定 CID 的弹幕。
 *
 * 使用旧版的 XML 接口 `https://comment.bilibili.com/{cid}.xml`【680846519515360†L41-L79】。该接口无需
 * 登录即可访问，但弹幕数量有限（最多约 5000 条），更完整的弹幕需使用分段 Protobuf 接口。
 * 这里返回的弹幕按照出现时间排序。
 *
 * @param {number} cid 视频页面的 CID
 * @returns {Promise<Array>} 弹幕列表，包含时间、类型、字号、颜色、时间戳、池、用户Hash、弹幕ID、内容
 */
async function getComments(cid) {
  if (!cid) throw new Error('必须提供CID');
  const url = `https://comment.bilibili.com/${cid}.xml`;
  const res = await Widget.http.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (ForwardWidgets)'
    }
  });
  const xml = res.data;
  // Parse the XML using the DOM parser provided by ForwardWidgets
  const $ = Widget.dom.parse(xml);
  const comments = [];
  $('d').each((_, elem) => {
    const attrs = $(elem).attr('p');
    if (!attrs) return;
    const parts = attrs.split(',');
    // p 属性格式：出现时间（秒）、类型、字号、颜色、发送时间戳、弹幕池、发送者midHash、弹幕dmid【680846519515360†L148-L174】
    const comment = {
      time: parseFloat(parts[0]),
      mode: parseInt(parts[1], 10),
      fontSize: parseInt(parts[2], 10),
      color: parseInt(parts[3], 10),
      timestamp: parseInt(parts[4], 10),
      pool: parseInt(parts[5], 10),
      midHash: parts[6],
      dmid: parts[7],
      content: $(elem).text()
    };
    comments.push(comment);
  });
  // Sort by appearance time
  comments.sort((a, b) => a.time - b.time);
  return comments;
}
