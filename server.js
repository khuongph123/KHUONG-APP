// --- Các thư viện cần thiết ---
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const https = require('https');
const puppeteer = require('puppeteer');

// --- Khởi tạo ứng dụng Express ---
const app = express();
const PORT = process.env.PORT || 3000;

// --- Cấu hình ---
app.use(cors());
app.use(express.static('.'));

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// ====================================================================
// !!! PHẦN THAY ĐỔI QUAN TRỌNG !!!
// ====================================================================

// Dán connection string bạn đã copy từ Browserless.io vào đây
const BROWSERLESS_CONNECTION_STRING = 'wss://chrome.browserless.io?token=2TCK6pkKFF5RpZz314043573bba3d0c2fd25ef8f138f8d9a5';

// --- BIẾN TOÀN CỤC & CACHE ---
let browserInstance = null;
const CACHE = {};
const CACHE_TTL = 10 * 60 * 1000; // 10 phút

// --- HÀM KHỞI ĐỘNG TRÌNH DUYỆT (ĐÃ CẬP NHẬT) ---
async function initializeBrowser() {
    if (!browserInstance) {
        console.log("[LOG] Đang kết nối đến trình duyệt ảo của Browserless.io...");
        
        // Kiểm tra xem người dùng đã dán key vào chưa
        if (!BROWSERLESS_CONNECTION_STRING || BROWSERLESS_CONNECTION_STRING.includes('2TCK6pkKFF5RpZz314043573bba3d0c2fd25ef8f138f8d9a5')) {
             throw new Error('Vui lòng cung cấp Connection String của Browserless.io trong file server.js');
        }

        // Thay vì "launch" (tự khởi động), chúng ta dùng "connect" (kết nối)
        browserInstance = await puppeteer.connect({
            browserWSEndpoint: BROWSERLESS_CONNECTION_STRING,
        });

        console.log("[LOG] Đã kết nối thành công đến Browserless.io.");
    }
    return browserInstance;
}
// ====================================================================
// CÁC PHẦN CÒN LẠI GIỮ NGUYÊN
// ====================================================================

// --- HÀM LẤY ẢNH ---
async function getOptimizedImage(articleUrl) {
    if (!articleUrl) return null;
    const baseUrl = 'https://congan.quangtri.gov.vn/';
    
    try {
        const { data: html } = await axios.get(articleUrl, { httpsAgent, timeout: 20000 });
        const $ = cheerio.load(html);
        
        const ogImage = $('meta[property="og:image"]').attr('content');
        if (ogImage) return new URL(ogImage, baseUrl).href;
        
        const twitterImage = $('meta[name="twitter:image"]').attr('content');
        if (twitterImage) return new URL(twitterImage, baseUrl).href;
        
        const articleImage = $('article img').first().attr('src');
        if (articleImage) return new URL(articleImage, baseUrl).href;
        
        const contentImage = $('.entry-content img, .td-post-content img').first().attr('src');
        if (contentImage) return new URL(contentImage, baseUrl).href;
        
    } catch (e) {
        console.warn(`[WARN] Không lấy được ảnh từ ${articleUrl}: ${e.message}`);
    }
    
    return null;
}

// --- API Endpoint ---
app.get('/api/news', async (req, res) => {
    const category = req.query.category || 'all';
    const now = Date.now();
    
    if (CACHE[category] && (now - CACHE[category].lastFetch < CACHE_TTL)) {
        console.log(`[LOG] Trả về dữ liệu từ cache cho danh mục: ${category}.`);
        return res.json(CACHE[category].data);
    }
    
    let page = null;
    try {
        const pageToScrape = category === 'all'
            ? 'https://congan.quangtri.gov.vn/'
            : `https://congan.quangtri.gov.vn/category/${category}/`;
        
        console.log(`[LOG] Cache rỗng/hết hạn. Đang cào dữ liệu từ trang: ${pageToScrape}`);
        
        const browser = await initializeBrowser();
        page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        await page.goto(pageToScrape, { waitUntil: 'networkidle2', timeout: 30000 });
        await page.waitForSelector('article, .td-module-thumb, .entry-title', { timeout: 10000 });
        
        const articlesFromPage = await page.evaluate(() => {
            const articles = [];
            const selectors = ['.td-block-span6', '.td-module-container', 'article.td-post', '.td-animation-stack', '.item-details'];
            let articleElements = [];

            for (const selector of selectors) {
                articleElements = document.querySelectorAll(selector);
                if (articleElements.length > 0) break;
            }
            
            articleElements.forEach(el => {
                const titleEl = el.querySelector('h3.entry-title a, .td-module-title a, a.td-image-wrap + h3 a, h3 a');
                const descriptionEl = el.querySelector('.td-excerpt, .entry-content, .td-post-text-excerpt');
                const imageEl = el.querySelector('img.entry-thumb, .td-module-thumb img, img');
                
                if (titleEl && titleEl.href) {
                    const link = titleEl.href;
                    if (!articles.some(a => a.link === link)) {
                        articles.push({
                            title: titleEl.innerText.trim() || titleEl.textContent.trim(),
                            link: link,
                            description: descriptionEl ? descriptionEl.innerText.trim() : '',
                            imageUrl: imageEl ? (imageEl.src || imageEl.getAttribute('data-img-url')) : null
                        });
                    }
                }
            });
            return articles.slice(0, 30);
        });
        
        // Không dùng close() với browserless.io vì browser là dùng chung
        // Thay vào đó chỉ cần đóng page
        if(page) await page.close();
        page = null;
        
        console.log(`[LOG] Đã cào được ${articlesFromPage.length} bài viết. Bắt đầu lấy ảnh...`);
        
        if (articlesFromPage.length === 0) {
            console.log(`[WARN] Không tìm thấy bài viết. Thử phương án dự phòng...`);
            // Phương án dự phòng giữ nguyên, không cần thay đổi
            // ...
        }
        
        const articlePromises = articlesFromPage.map(async (item) => {
            if (!item.imageUrl || item.imageUrl.includes('placeholder')) {
                const imageUrl = await getOptimizedImage(item.link);
                return { ...item, imageUrl: imageUrl || item.imageUrl };
            }
            return item;
        });
        
        const finalArticles = await Promise.all(articlePromises);
        CACHE[category] = { data: finalArticles, lastFetch: now };
        console.log(`[LOG] Lấy thành công và đã cập nhật cache cho '${category}'.`);
        res.json(finalArticles);
        
    } catch (error) {
        if (page) await page.close();
        console.error(`[ERROR] Lỗi khi lấy tin tức cho danh mục ${category}:`, error.message);
        res.status(500).json({ error: `Không thể lấy dữ liệu cho danh mục ${category}.`, details: error.message });
    }
});

// --- Image Proxy Endpoint ---
app.get('/api/image-proxy', async (req, res) => {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).send('Missing url parameter');
    
    try {
        const response = await axios.get(imageUrl, {
            responseType: 'stream',
            httpsAgent,
            timeout: 20000 
        });
        response.data.pipe(res);
    } catch (error) {
        console.error('[ERROR] Image proxy error:', error.message);
        res.status(500).send('Error fetching image');
    }
});

// --- Graceful Shutdown ---
process.on('SIGINT', async () => {
    console.log('[LOG] Đang đóng kết nối trình duyệt...');
    if (browserInstance) await browserInstance.disconnect();
    process.exit(0);
});

app.listen(PORT, () => {
    console.log(`✅ Server đang chạy tại http://localhost:${PORT}`);
    initializeBrowser();
});