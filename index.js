const puppeteer = require('puppeteer');
const fs = require('fs');
const sharp = require('sharp');
const TelegramBot = require('node-telegram-bot-api');

// Your Telegram Bot setup
const TOKEN = '7302160357:AAFy35WO6Jc95tOhLqRua1d0icVMzatI5dk';
const bot = new TelegramBot(TOKEN, { polling: true });

async function preprocessImage(imagePath) {
    try {
        const outputPath = 'preprocessed_image.png';

        await sharp(imagePath)
            .resize(1500,500)
            .sharpen()
            .threshold(230)
            .toFile(outputPath);

        return outputPath;
    } catch (error) {
        console.error(`Error preprocessing image: ${error.message}`);
        return null;
    }
}

async function captureCaptchaImage(page, xpath) {
    try {
        const [captchaElement] = await page.$x(xpath);

        if (!captchaElement) {
            console.error("Captcha element not found.");
            return null;
        }

        const captchaImageBuffer = await captchaElement.screenshot();
        const imagePath = 'captcha_image.png';
        fs.writeFileSync(imagePath, captchaImageBuffer);

        // Preprocess the image
        const preprocessedImagePath = await preprocessImage(imagePath);
        return preprocessedImagePath;
    } catch (error) {
        console.error(`Error in capturing CAPTCHA image: ${error.message}`);
        return null;
    }
}

async function processCaptchaImage(page, imagePath) {
    if (!imagePath) return null;

    try {
        // Open a new tab to interact with the Tesseract web service
        const tesseractPage = await page.browser().newPage();
        await tesseractPage.goto('https://tesseract-web-sand.vercel.app/', { waitUntil: 'networkidle2' });

        // Upload the preprocessed CAPTCHA image
        const [uploadInput] = await tesseractPage.$x('//*[@id="file"]');
        if (uploadInput) {
            console.log('Uploading CAPTCHA image...');
            await uploadInput.uploadFile(imagePath);
        } else {
            console.error("Upload input not found.");
            await tesseractPage.close();
            return null;
        }

        // Wait for the result to be available
        await tesseractPage.waitForTimeout(20000); // Adjust the timeout if needed
        console.log('Waiting for result...');

        // Use the provided CSS selector to find the result element
        const resultSelector = 'body > div > div.ui.grid.stackable > div > div:nth-child(2) > div > div.content.content-result > div > div > div.sixteen.wide.column.output > div > pre';
        const captchaText = await tesseractPage.evaluate((selector) => {
            const element = document.querySelector(selector);
            return element ? element.innerText.trim() : null;
        }, resultSelector);

        console.log('CAPTCHA text:', captchaText);
        await tesseractPage.close();
        return captchaText;
    } catch (error) {
        console.error(`Error processing CAPTCHA image: ${error.message}`);
        return null;
    }
}



bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'Welcome! Use /setcreds <username> <password> to set your credentials.');
});

bot.onText(/\/setcreds (.+) (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const username = match[1];
    const password = match[2];
    fs.writeFileSync(`credentials_${chatId}.txt`, `${username}\n${password}`);
    bot.sendMessage(chatId, 'Credentials saved. Use /run to execute the script.');
});

bot.onText(/\/run/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        const credentials = fs.readFileSync(`credentials_${chatId}.txt`, 'utf8').split('\n');
        const username = credentials[0];
        const password = credentials[1];

        const browser = await puppeteer.launch({
            headless: true,
            defaultViewport: { width: 1059, height: 772 },
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.goto('https://kp.christuniversity.in/KnowledgePro/StudentLogin.do', { waitUntil: 'networkidle2' });

        await page.waitForTimeout(15000); 
        await page.waitForSelector('#username');
        await page.waitForSelector('#password');

        await page.type('#username', username);
        await page.type('#password', password);

        const captchaImagePath = await captureCaptchaImage(page, '/html/body/form/div[3]/div/div[1]/div/div/div[3]/div/div[3]/img[1]');
        const captchaText = await processCaptchaImage(page, captchaImagePath);

        if (captchaText) {
            await page.type('#captchaBox', captchaText);
            await page.click('#Login > b');
            
            await page.waitForNavigation({ waitUntil: 'networkidle2' });
            await page.goto('https://kp.christuniversity.in/KnowledgePro/studentWiseAttendanceSummary.do?method=getIndividualStudentWiseSubjectAndActivityAttendanceSummary', { waitUntil: 'networkidle2' });

            await page.waitForSelector('body > div.cotbox > div');
            const contentText = await page.evaluate(() => document.querySelector('body > div.cotbox > div').innerText);
            bot.sendMessage(chatId, `Content:\n${contentText}`);
        } else {
            bot.sendMessage(chatId, "Failed to process CAPTCHA.");
        }

        await browser.close();
    } catch (error) {
        bot.sendMessage(chatId, `An error occurred: ${error.message}`);
    }
});
