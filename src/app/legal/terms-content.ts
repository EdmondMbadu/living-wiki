// The canonical terms are authored in English. Keep this legal document in English
// across localized routes (lang="en" in the template), rather than substituting an
// unreviewed machine translation. Navigation and the privacy page remain localized.
import { TERMS_UPDATED_LABEL } from './terms-policy';

export const TERMS_CONTENT = {
  eyebrow: 'Our shared ground rules',
  title: 'Terms and Conditions',
  intro: 'A little clarity makes room for a lot of discovery. These terms explain how to use LivingWiki and its AI avatars responsibly, safely, and for learning.',
  updatedLabel: TERMS_UPDATED_LABEL,
  sections: [
    {
      id: 'agreement',
      heading: 'Who these terms cover',
      body: [
        'These Terms and Conditions are between you and Mind Palace Inc. ("we", "us", or "our"), the provider of LivingWiki™. They apply to our website, workspaces, public atlases, boards, chats, and AI features, including Picamo™, talking avatars, voice assistants, custom personas, and AI experiences embedded in or shared through LivingWiki (the "Service"). They apply to visitors, account holders, creators, and organizations.',
        'By accessing or using the Service, you agree to these terms. If you do not agree, do not use the Service. If you use it for an organization, you confirm that you have authority to accept these terms on its behalf. These terms do not replace any rights you have under mandatory applicable law.',
        'LivingWiki is an independent product of Mind Palace Inc. and is not affiliated with, endorsed by, or sponsored by the Wikimedia Foundation, Wikipedia, or any related Wikimedia project.',
      ],
    },
    {
      id: 'educational-purpose',
      heading: 'AI is exclusively for education',
      body: [
        'Our AI avatars and AI-generated conversations, speech, images, summaries, and other outputs are provided exclusively for educational purposes. Their role is to support learning, research, discovery, and understanding information about subjects, places, people, and materials. This applies to Picamo and every other default, customized, or user-created AI persona, regardless of its name, appearance, voice, or where it is shared.',
        'Use the AI to ask questions, explore ideas, understand sources, and learn respectfully. You may not repurpose it for sexual entertainment, abuse, deception, propaganda promoting violence, or other prohibited activity. Calling a request "educational", "fiction", "research", "satire", "a test", or "roleplay" does not excuse a violation.',
        'Good-faith, age-appropriate, non-graphic study of difficult subjects—such as the history of war, human rights, discrimination, or health—is permitted when it serves a legitimate educational purpose and does not promote harm, provide dangerous operational guidance, or otherwise violate these terms.',
      ],
    },
    {
      id: 'acceptable-use',
      heading: 'Content and conduct we prohibit',
      body: [
        'Do not request, upload, generate, speak, display, publish, or distribute the content below through the Service. These rules cover prompts, source documents, images, audio, avatar instructions, names, conversations, generated outputs, and material shared or exported from the Service. Attempts and encouragement of others to violate these rules are also prohibited.',
      ],
      rules: [
        {
          heading: 'Pornography and sexual exploitation',
          text: 'No pornography, sexually explicit or arousing content, sexual roleplay, sexual solicitation, non-consensual intimate material, sexual deepfakes, or sexual exploitation. Any sexual content involving minors, or people presented as minors, is strictly prohibited. Non-graphic, age-appropriate health education must remain factual and educational.',
        },
        {
          heading: 'Hate, harassment, and offensive abuse',
          text: 'No hateful or dehumanizing attacks, discriminatory slurs, threats, bullying, stalking, targeted humiliation, or extremely offensive, obscene, or abusive language. Do not attack people based on characteristics such as race, ethnicity, nationality, religion, sex, gender, sexual orientation, or disability, or make an avatar do so.',
        },
        {
          heading: 'Violence, warfare, and extremism',
          text: 'No inciting, celebrating, recruiting for, or providing practical assistance for war, terrorism, violent extremism, abuse, or attacks. No weapon-building instructions, targeting assistance, combat tactics, graphic gore for shock or entertainment, or encouragement of self-harm or harm to others.',
        },
        {
          heading: 'Deception and impersonation',
          text: 'No scams, fraud, blackmail, deliberately false accusations, or fabricated evidence. Do not impersonate a person or organization without authorization, create deceptive endorsements or political persuasion campaigns, or present an AI avatar or synthetic voice as an actual person speaking.',
        },
        {
          heading: 'Privacy and rights violations',
          text: 'No doxxing, unauthorized surveillance, publishing private or confidential information, or using another person’s image, likeness, voice, identity, or work without the necessary rights and consent. Do not upload stolen material, credentials, or personal data you are not authorized to share.',
        },
        {
          heading: 'Illegal activity and system abuse',
          text: 'No unlawful activity, exploitation, trafficking, malicious code, credential theft, unauthorized access, or assistance that enables wrongdoing. Do not overload the Service, evade usage limits or suspensions, scrape restricted information, or interfere with another person’s access.',
        },
      ],
    },
    {
      id: 'ai-safeguards',
      heading: 'Do not manipulate the AI into harmful speech',
      body: [
        'You must not try to make Picamo or another AI say or produce material that violates these terms. This includes jailbreaks, prompt injection, instructions to ignore safety rules, hidden instructions in uploaded sources, coded or translated prompts, repeated reformulations after a refusal, and attempts to extract restricted system instructions, secrets, or other users’ data.',
        'Do not use custom personas, cloned voices, recordings, or editing tools to make an avatar appear to endorse hate, pornography, violence, unlawful activity, or other prohibited conduct. Do not remove context, splice recordings, or misattribute generated speech to deceive people about what the Service or a real person said or supports.',
        'If the AI gives an inappropriate answer, stop that interaction and report it. An unexpected response, a missing filter, or a successful attempt to bypass a safeguard does not grant permission to continue, reproduce, or distribute prohibited content. Report suspected vulnerabilities without exploiting them or accessing other people’s information.',
      ],
    },
    {
      id: 'avatars-and-sharing',
      heading: 'Avatars, voices, and shared outputs',
      body: [
        'AI avatars are software-generated educational interfaces. An avatar’s realistic appearance, familiar name, expressive voice, or first-person language does not make it a human, a licensed professional, or an authorized representative of the person, business, place, or institution it describes.',
        'You may use a likeness, photo, voice, or recording only if you have the rights and any consent necessary for the intended use, including AI processing, voice synthesis, publication, and sharing. Do not clone or simulate someone’s identity without authorization. A creator is responsible for the instructions, source materials, permissions, and audience of their custom avatar.',
        'Before sharing or publishing AI output or a recording, review it for accuracy, safety, privacy, and rights. Clearly disclose that an avatar’s speech and other synthetic content are AI-generated when sharing could otherwise mislead someone. Do not claim that an output represents the views or endorsement of Mind Palace Inc., LivingWiki, or a real person or organization.',
      ],
    },
    {
      id: 'accounts-and-age',
      heading: 'Account responsibility and younger learners',
      body: [
        'Provide accurate account details, keep your login credentials secure, and notify us if you suspect unauthorized access. You are responsible for your own use and for people you authorize to access your account or workspace. Do not share credentials to evade restrictions or create accounts to bypass enforcement.',
        'The Service is not intended for children under 13, or under a higher minimum age required in their location. If you are below the age of legal adulthood, you may use the Service only with the permission and supervision of a parent or legal guardian who accepts these terms. Do not misrepresent your age.',
        'Parents, guardians, schools, and other organizations must assess whether an experience and its sources are suitable for their learners, provide appropriate supervision, and obtain any legally required permissions. A school account or an educational label does not guarantee that every AI response is accurate or appropriate for every age.',
      ],
    },
    {
      id: 'your-content',
      heading: 'Your materials and public spaces',
      body: [
        'You retain your rights in the content you upload or submit. You grant us a non-exclusive permission to host, store, copy, process, transform, index, and display that content as necessary to provide and secure the Service, including generating educational responses and sharing materials according to your settings. This permission does not transfer ownership of your content to us.',
        'You are responsible for having the rights, licenses, and permissions needed for your materials and for ensuring that they comply with these terms. Do not publish confidential, infringing, defamatory, or misleading materials. Do not assume that AI-generated material is unique, free of third-party rights, or eligible for copyright protection.',
        'If you publish an atlas, board, avatar, or shared conversation, review what visitors can access. Public material and recordings may be copied or redistributed by others, and making something private later cannot recall copies already made. Workspace owners are responsible for their publication and access settings.',
        'The Service, its software, branding, and our original avatar designs remain the property of Mind Palace Inc. or their respective owners. You receive permission to use the Service under these terms, not ownership of its technology or brands.',
      ],
    },
    {
      id: 'ai-limitations',
      heading: 'Check answers before relying on them',
      body: [
        'AI can invent facts, mispronounce names, misunderstand context, omit sources, reproduce bias, and provide outdated or inappropriate answers. A confident voice, citation, or lifelike avatar is not a guarantee of accuracy. Check important claims against reliable, current sources and apply your own judgment.',
        'The Service does not provide medical, mental-health, legal, financial, or other licensed professional advice, emergency assistance, or a substitute for a qualified teacher or professional. Do not use it to diagnose or treat a condition, make high-stakes decisions about someone’s rights or safety, or direct military or other dangerous operations.',
        'For emergencies or an immediate risk of harm, contact the appropriate local emergency services or a qualified professional. Do not rely on an avatar to identify an emergency, monitor your wellbeing, or arrange help.',
        'Statements made by an AI avatar do not create contracts, authorize transactions, modify these terms, or constitute a promise, professional opinion, or endorsement by us. Product descriptions and verified human communications remain distinct from generated dialogue.',
      ],
    },
    {
      id: 'privacy',
      heading: 'Privacy and conversation data',
      body: [
        'Our Privacy Policy explains how the Service handles information. Conversations, uploaded sources, and information needed to operate voice or avatar features may be processed by us and our service providers. Public atlas chats may be logged and associated with anonymous identifiers or signed-in account details, as described in the Privacy Policy.',
        'Do not treat an avatar conversation as confidential or privileged. Avoid submitting passwords, payment credentials, highly sensitive personal information, or information you are not authorized to provide. Obtain any permissions required before recording another person, uploading their information, or sharing a conversation.',
      ],
    },
    {
      id: 'enforcement-and-reporting',
      heading: 'Reporting misuse and enforcing the rules',
      body: [
        'To report harmful output, suspected misuse, an unauthorized likeness or voice, or a rights concern, contact jim.walker@mindpalace.com. Include the relevant page or avatar link, an approximate date and time, and a brief description. You may include a non-sensitive excerpt or screenshot when lawful; do not send illegal sexual material, credentials, or unnecessary personal information.',
        'We may investigate suspected violations, refuse requests, restrict features, remove or limit access to content, and suspend or terminate accounts where reasonably necessary to address abuse, security threats, legal obligations, or serious or repeated violations. We may act immediately when the circumstances require it. Where appropriate and permitted, we may preserve relevant records or cooperate with lawful requests from authorities.',
        'We may review reported or suspected misuse, but we do not promise to review every interaction, detect every violation, or prevent every harmful response. These rules describe permitted use; they are not a guarantee that technical safeguards will block every prohibited request.',
        'If you believe a restriction was applied in error, contact us at the same address with enough information to identify your account or content and explain your concern. We will consider the information you provide. This does not limit any complaint or appeal rights available under applicable law.',
      ],
    },
    {
      id: 'plans-and-third-parties',
      heading: 'Paid features and third-party services',
      body: [
        'Some features have paid plans, usage limits, or additional terms presented before purchase. Review the price, billing interval, renewal conditions, and cancellation information shown at checkout. Any refunds, cancellation rights, and changes to charges are subject to the applicable purchase terms and mandatory law. These terms do not remove statutory refund rights.',
        'The Service may link to third-party sources or use third-party hosting, model, voice, payment, or other providers. Third-party services may have their own terms and privacy policies. A link, citation, or generated reference does not mean we endorse that provider or guarantee its content.',
        'We may update, limit, suspend, or discontinue features for operational, safety, or legal reasons. Availability and AI responses may vary. Any commitments in your applicable paid agreement and rights required by law continue to apply.',
      ],
    },
    {
      id: 'disclaimers-and-liability',
      heading: 'Disclaimers and limits of liability',
      body: [
        'To the extent permitted by applicable law, the Service and its AI outputs are provided "as is" and "as available". We do not warrant that the Service will be uninterrupted, secure, error-free, accurate, complete, or suitable for a particular purpose. We disclaim implied warranties of merchantability, fitness for a particular purpose, and non-infringement only where the law allows.',
        'To the extent permitted by applicable law, Mind Palace Inc. is not liable for indirect, incidental, special, consequential, or punitive losses, or loss of profits, business opportunities, or data arising from your use of the Service. You remain responsible for reviewing outputs and for your own decisions, publications, and misuse.',
        'Nothing in these terms excludes or limits liability for fraud, fraudulent misrepresentation, intentional misconduct, gross negligence, death or personal injury caused by negligence, or any liability that cannot lawfully be excluded or limited. Mandatory consumer protections, statutory warranties, and remedies remain available to you.',
      ],
    },
    {
      id: 'disputes',
      heading: 'Responsibility and resolving concerns',
      body: [
        'You are responsible for unlawful use of the Service and for harm caused by your violations of these terms. If you use the Service on behalf of a business or organization, that business or organization agrees, to the extent permitted by law, to indemnify Mind Palace Inc. against third-party claims, damages, and reasonable costs arising from its unlawful content, rights violations, or intentional misuse. This does not cover claims caused by our own misconduct and does not impose an indemnity on consumers using the Service personally.',
        'If a concern arises, contact us so we can try to resolve it. Nothing in these terms requires binding arbitration, waives your right to bring a claim in a competent court, or prevents you from contacting a regulator. Any mandatory law or consumer jurisdiction protections that apply to you remain in effect.',
        'If a provision is found unenforceable, the rest of these terms remain in effect to the extent legally possible. Our decision not to enforce a provision on one occasion does not waive our right to enforce it later.',
      ],
    },
    {
      id: 'changes-and-contact',
      heading: 'Changes to these terms and contact',
      body: [
        'We may update these terms as the Service evolves. We will publish revisions on this page and update the effective date and version. For material changes, we will provide appropriate notice and obtain any consent required by applicable law. Changes apply prospectively from their stated effective date and do not remove rights that have already accrued.',
        'If you do not agree to revised terms, stop using the Service. Continued use after revised terms take effect constitutes acceptance only where permitted by law and after any required notice or consent. The English text is the original version of this document; any translation is for convenience, subject to applicable law.',
        'Questions about these terms, safety, permissions, or your account can be sent to jim.walker@mindpalace.com. The Service is operated by Mind Palace Inc., the provider of LivingWiki.',
      ],
    },
  ],
};
