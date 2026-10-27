/**
 * Multilingual retrieval check: English passages, Arabic questions.
 *
 * Embeds a small English knowledge base and questions in Modern Standard
 * Arabic and Algerian Darija with every known embedding model, then reports
 * how often the right passage ranks first. Synthetic data only.
 *
 * Run from the repository root: pnpm models:eval-multilingual
 * Needs OPENROUTER_API_KEY in the root .env. Costs well under $0.01.
 */

import { OpenRouterEmbed } from "../openrouter";
import { OPENROUTER_EMBEDDING_MODELS } from "../data/openrouter_models";

const PASSAGES = [
	"Our support team is available Sunday to Thursday, from 9 am to 5 pm Algiers time. Messages sent outside these hours are answered the next working day.",
	"Customers can request a full refund within 14 days of purchase if the product has not been used. Refunds are sent to the original payment method within 5 business days.",
	"We deliver to all 58 wilayas of Algeria. Delivery to Algiers takes 24 to 48 hours; other regions take 3 to 5 days. Cash on delivery is accepted everywhere.",
	"We never sell personal data. Customer data is stored on servers in Europe, encrypted at rest, and deleted on request within 30 days.",
	"The Starter plan costs 2,900 DZD per month and includes up to 500 orders. The Pro plan costs 7,900 DZD per month with unlimited orders and priority support.",
	"The app connects to Shopify stores in one click. Orders, products and inventory sync automatically every five minutes.",
	"The dashboard is available in Arabic, French and English. Customers receive SMS notifications in the language of their order.",
	"To reset your password, click 'Forgot password' on the login page. A six-digit code is sent to your email and expires after ten minutes.",
];

// `answer` is the index of the passage that answers the question
const QUESTIONS: Array<{ text: string; answer: number; variety: "msa" | "darija" }> = [
	{ text: "ما هي ساعات عمل فريق الدعم؟", answer: 0, variety: "msa" },
	{ text: "هل يمكنني استرجاع أموالي إذا لم أستخدم المنتج؟", answer: 1, variety: "msa" },
	{ text: "كم يستغرق التوصيل إلى ولاية وهران؟", answer: 2, variety: "msa" },
	{ text: "هل تبيعون بياناتي الشخصية لجهات أخرى؟", answer: 3, variety: "msa" },
	{ text: "كم سعر الاشتراك الشهري في الخطة الاحترافية؟", answer: 4, variety: "msa" },
	{ text: "كيف أربط متجري على شوبيفاي بالتطبيق؟", answer: 5, variety: "msa" },
	{ text: "هل لوحة التحكم متوفرة باللغة العربية؟", answer: 6, variety: "msa" },
	{ text: "نسيت كلمة المرور، ماذا أفعل؟", answer: 7, variety: "msa" },
	{ text: "واش نقدر نخلص كي توصلني السلعة؟", answer: 2, variety: "darija" },
	{ text: "شحال يسوى الاشتراك برو في الشهر؟", answer: 4, variety: "darija" },
	{ text: "نسيت المودباس تاعي، كيفاش نرجعو؟", answer: 7, variety: "darija" },
];

const cosine = (a: number[], b: number[]): number => {
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		na += a[i] * a[i];
		nb += b[i] * b[i];
	}
	return dot / (Math.sqrt(na) * Math.sqrt(nb));
};

type ModelResult = {
	model: string;
	msa: number;
	darija: number;
	/** Mean of (score of the right passage - best wrong score); higher is safer. */
	margin: number;
	cost: number;
	misses: string[];
};

const evaluate = async (
	model: (typeof OPENROUTER_EMBEDDING_MODELS)[number],
): Promise<ModelResult> => {
	const inputs = [...PASSAGES, ...QUESTIONS.map((q) => q.text)];
	const { embeddings, usage } = await OpenRouterEmbed(model.id, inputs);
	const passages = embeddings.slice(0, PASSAGES.length);
	const questions = embeddings.slice(PASSAGES.length);

	const result: ModelResult = {
		model: model.id,
		msa: 0,
		darija: 0,
		margin: 0,
		cost: (usage.totalTokens / 1_000_000) * model.inputPrice,
		misses: [],
	};

	questions.forEach((vector, i) => {
		const question = QUESTIONS[i];
		const scores = passages.map((p) => cosine(vector, p));
		const best = scores.indexOf(Math.max(...scores));
		const bestWrong = Math.max(...scores.filter((_, j) => j !== question.answer));
		result.margin += (scores[question.answer] - bestWrong) / QUESTIONS.length;
		if (best === question.answer) result[question.variety]++;
		else result.misses.push(`q${i + 1}->p${best + 1}`);
	});

	return result;
};

const main = async () => {
	const msaTotal = QUESTIONS.filter((q) => q.variety === "msa").length;
	const darijaTotal = QUESTIONS.length - msaTotal;

	console.log("model                           MSA   Darija  margin   cost($)    misses");
	for (const model of OPENROUTER_EMBEDDING_MODELS) {
		try {
			const r = await evaluate(model);
			console.log(
				`${r.model.padEnd(32)}${`${r.msa}/${msaTotal}`.padEnd(6)}${`${r.darija}/${darijaTotal}`.padEnd(8)}${r.margin.toFixed(3).padEnd(9)}${r.cost.toFixed(7).padEnd(11)}${r.misses.join(" ") || "-"}`,
			);
		} catch (err) {
			console.log(`${model.id.padEnd(32)}failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
};

void main();
