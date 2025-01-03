const Providers = {
	ARXIV: "arXiv",
	ACL_ANTHOLOGY: "ACL Anthology",
	SEMANTIC_SCHOLAR: "Semantic Scholar",
};

async function fetchPaperInfo(quickAdd, settings) {
	const {
		quickAddApi: { inputPrompt },
		app,
	} = quickAdd;

	const url = await inputPrompt("📖 Paper URL", "https://");
	if (!url) return;

	const [provider, id] = parseProviderAndId(url);
	let info;

	switch (provider) {
		case Providers.ARXIV:
			info = await fetchPaperInfoFromArxiv(id);
			break;
		case Providers.ACL_ANTHOLOGY:
			info = await fetchPaperInfoFromACLAnthology(id);
			break;
		case Providers.SEMANTIC_SCHOLAR:
			info = await handleSemanticScholar(id, settings);
			break;
		default:
			info = await handleUnknownProvider(url, settings);
	}

	info.linkifiedAuthors = info.authors.map(linkify).join(", ");
	info.linkifiedAuthorsArray = `[${info.authors
		.map(linkify)
		.map((author) => `"${author}"`)
		.join(", ")}]`;
	info.linkifiedAuthorsArrayBlock = `\n- ${info.authors
		.map(linkify)
		.map((author) => `"${author}"`)
		.join("\n- ")}`;
	info.authors = info.authors.map((author) => author.name).join(", ");

	info.bibtexKey = info.bibtex.match(/{(.+?),/)[1];

	info.url = url;

	quickAdd.variables = info;
}

async function handleSemanticScholar(id, settings) {
	const [info, externalIds] = await fetchPaperInfoFromSemanticScholarWithID(
		id,
		settings["Semantic Scholar API Key"],
	);

	if (Object.hasOwn(externalIds, "ACL")) {
		return await fetchPaperInfoFromACLAnthology(externalIds.ACL);
	}
	if (Object.hasOwn(externalIds, "ArXiv")) {
		return await fetchPaperInfoFromArxiv(externalIds.ArXiv);
	}
	return info;
}

async function handleUnknownProvider(url, settings) {
	const [info, _] = await fetchPaperInfoFromSemanticScholarWithAnyURL(
		url,
		settings["Semantic Scholar API Key"],
	);
	return info;
}

async function fetchPaperInfoFromArxiv(id) {
	const api_resp = await request(
		`https://export.arxiv.org/api/query?id_list=${id}`,
	);
	const xml = new DOMParser().parseFromString(api_resp, "text/xml");
	const entry = xml.querySelector("entry");

	const abs_resp = await request(`https://arxiv.org/abs/${id}`);
	const abs_html = new DOMParser().parseFromString(abs_resp, "text/html");

	return {
		title: abs_html.querySelector('meta[name="citation_title"]').content,
		authors: Array.from(entry.querySelectorAll("author")).map(
			(author) => author.querySelector("name").textContent,
		),
		abstract: abs_html.querySelector('meta[property="og:description"]').content,
		year: entry.querySelector("published").textContent.slice(0, 4),
		month: entry
			.querySelector("published")
			.textContent.slice(5, 7)
			.replace(/^0/, ""),
		bibtex: await request(`https://arxiv.org/bibtex/${id}`),
		doi: abs_html.querySelector("a#arxiv-doi-link").href,
		venue: Providers.ARXIV,
		comment: abs_html.querySelector("td.comments")?.textContent || " ",
		abstract_url: `https://arxiv.org/abs/${id}`,
		pdf_url: `https://arxiv.org/pdf/${id}`,
		html_url: `https://arxiv.org/html/${id}`,
	};
}

async function fetchPaperInfoFromACLAnthology(id) {
	const resp = await request(`https://aclanthology.org/${id}`);
	const html = new DOMParser().parseFromString(resp, "text/html");

	return {
		title: html.querySelector('meta[name="citation_title"]').content,
		authors: Array.from(
			html
				.querySelectorAll('meta[name="citation_author"]')
				.values()
				.map((node) => node.content),
		),
		abstract: html.querySelector("div.acl-abstract span").textContent,
		year: html
			.querySelector('meta[name="citation_publication_date"]')
			.content.slice(0, 4),
		month: html
			.querySelector('meta[name="citation_publication_date"]')
			.content.slice(5, 7),
		bibtex: html.querySelector("pre#citeBibtexContent").textContent,
		doi: html.querySelector('meta[name="citation_doi"]').content,
		venue: html.querySelector('a[href^="/venues/"]').textContent,
		// To avoid QuickAdd displaying additional prompts, set the default value to
		// white space for attributes that are not available for a specific provider.
		comment: " ",
		abstract_url: `https://aclanthology.org/${id}`,
		pdf_url: `https://aclanthology.org/${id}.pdf`,
		html_url: " ",
	};
}

async function fetchPaperInfoFromSemanticScholarWithAnyURL(url, apiKey) {
	return await fetchPaperInfoFromSemanticScholar(`URL:${url}`, apiKey);
}

async function fetchPaperInfoFromSemanticScholarWithID(id, apiKey) {
	return await fetchPaperInfoFromSemanticScholar(id, apiKey);
}

async function fetchPaperInfoFromSemanticScholar(endpoint, apiKey) {
	const fields = [
		"paperId",
		"externalIds",
		"url",
		"title",
		"abstract",
		"venue",
		"publicationDate",
		"citationStyles",
		"authors.name",
	];
	const url = `https://api.semanticscholar.org/graph/v1/paper/${endpoint}?fields=${fields.join(",")}`;
	const headers = {};
	if (apiKey) {
		headers["x-api-key"] = apiKey;
	}

	const MAX_RETRY = 3;
	let retryCount = 0;
	let resp;

	while (retryCount < MAX_RETRY) {
		resp = await requestUrl({ url, headers, throw: false });
		if (resp.status === 200) {
			break;
		}
		if (resp.status === 429) {
      // Too Many Requests
			await sleep(1000);
			retryCount++;
			continue;
		}
		if (resp.status === 400) {
			const msg = "Invalid request";
			notice(msg);
			throw new Error(msg);
		}
		if (resp.status === 404) {
			const msg = "Paper not found";
			notice(msg);
			throw new Error(msg);
		}
		notice(`Unexpected status code: ${resp.status}`);
		throw new Error(`Unexpected status code: ${resp.status}`);
	}
	if (resp.status !== 200) {
		const msg = "Max retry exceeded";
		notice(msg);
		throw new Error(msg);
	}

	const data = resp.json;

	return [
		{
			title: data.title,
			authors: data.authors.map((author) => author.name),
			abstract: data.abstract,
			year: data.publicationDate.slice(0, 4),
			month: data.publicationDate.slice(5, 7).replace(/^0/, ""),
			bibtex: data.citationStyles.bibtex,
			doi: data.externalIds?.DOI || " ",
			venue: data.venue,
			comment: " ",
			abstract_url: data.url,
			pdf_url: " ",
			html_url: " ",
		},
		data.externalIds,
	];
}

function parseProviderAndId(url) {
	const result = URL.parse(url);

	if (result.hostname === "arxiv.org") {
		return [Providers.ARXIV, result.pathname.split("/")[2]];
	}

	if (result.hostname === "aclanthology.org") {
		const last = result.pathname.split("/")[1];
		if (last.endsWith(".pdf")) {
			return [Providers.ACL_ANTHOLOGY, last.slice(0, -4)];
		}
		return [Providers.ACL_ANTHOLOGY, last];
	}

	if (result.hostname.endsWith("semanticscholar.org")) {
		return [
			Providers.SEMANTIC_SCHOLAR,
			result.pathname
				.split("/")
				.reverse()
				.find((part) => part),
		];
	}
}

function linkify(text) {
	return `[[${text}]]`;
}

module.exports = {
	entry: fetchPaperInfo,
	settings: {
		name: "Fetch Paper Info",
		author: "Ryo Takahashi",
		options: {
			"Semantic Scholar API Key": {
				type: "text",
				defaultValue: "",
			},
		},
	},
};
