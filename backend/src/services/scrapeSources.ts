import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import FirecrawlApp from "@mendable/firecrawl-js";

dotenv.config();

// Define the story interface
interface Story {
  headline: string;
  link: string;
  date_posted?: Date | string;
}

interface CombinedText {
  stories: Story[];
}

const app = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

console.log("Resend API Key configured:", !!process.env.RESEND_API_KEY);

export async function scrapeSources(sources: string[]) {
  const num_sources = sources.length;
  console.log(`Scraping ${num_sources} sources...`);

  const combinedText: CombinedText = {
    stories: [],
  };

  const useTwitter = process.env.X_API_BEARER_TOKEN !== undefined;
  const useScrape = process.env.FIRECRAWL_API_KEY !== undefined;

  for (const source of sources) {
    if (source.includes("x.com")) {
      if (useTwitter) {
        const usernameMatch = source.match(/x\.com\/([^\/]+)/);
        if (usernameMatch) {
          const username = usernameMatch[1];
          const startTime = new Date();
          startTime.setHours(0, 0, 0, 0);
          const endTime = new Date();
          endTime.setHours(23, 59, 59, 999);

          const query = `from:${username}`;
          const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(
            query,
          )}&start_time=${startTime.toISOString()}&end_time=${endTime.toISOString()}`;

          const response = await fetch(url, {
            headers: {
              Authorization: `Bearer ${process.env.X_API_BEARER_TOKEN}`,
            },
          });

          const tweets = await response.json();

          if (tweets.meta?.result_count === 0) {
            // No tweets found
          } else if (Array.isArray(tweets.data)) {
            console.log(`Tweets found from username ${username}`);
            const stories = tweets.data.map((tweet: any) => {
              return {
                headline: tweet.text,
                link: `https://x.com/i/status/${tweet.id}`,
                date_posted: startTime,
              };
            });
            combinedText.stories.push(...stories);
          } else {
            console.error("Expected tweets.data to be an array:", tweets.data);
          }
        }
      }
    } else {
      if (useScrape) {
        try {
          const scrapeResponse = await app.scrapeUrl(source, {
            formats: ["markdown"],
            timeout: 60000,
          });

          if (!scrapeResponse.success) {
            console.error(
              `Failed to scrape ${source}: ${scrapeResponse.error}`,
            );
            continue;
          }

          try {
            const model = genAI.getGenerativeModel({
              model: "gemini-2.0-flash",
            });

            const prompt = `Today is ${new Date().toLocaleDateString()}. Return only today's AI or LLM related story or post headlines and links in JSON format from the following scraped content. They must be posted today. The format should be {"stories": [{"headline": "headline1", "link": "link1", "date_posted": "date1"}, {"headline": "headline2", "link": "link2", "date_posted": "date2"}, ...]}. If there are no stories or posts related to AI or LLMs from today, return {"stories": []}. The source link is ${source}. If the story or post link is not absolute, make it absolute with the source link. IMPORTANT: Return only the raw JSON without any markdown formatting or code blocks.

            Scraped Content: ${scrapeResponse.markdown}`;

            const result = await model.generateContent(prompt);
            const response = result.response.text().trim();

            // Remove any markdown code block indicators if present
            const cleanJson = response.replace(/```json\n?|\n?```/g, "").trim();
            const todayStories = JSON.parse(cleanJson);

            console.log(
              `Found ${todayStories.stories.length} stories from ${source}`,
            );
            combinedText.stories.push(...todayStories.stories);
          } catch (error) {
            console.error("Error processing stories:", error);
          }
        } catch (error) {
          if (error instanceof Error) {
            console.error(`Error scraping ${source}: ${error.message}`);
          } else {
            console.error(`Unknown error scraping ${source}`);
          }
          continue;
        }
      }
    }
  }

  return combinedText;
}
