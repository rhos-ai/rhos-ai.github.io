import { careerPositions } from './careers-data.js';

(() => {
    const positions = careerPositions;

    const allowedResumeTypes = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    const maxResumeBytes = 10 * 1024 * 1024;
    const turnstileSiteKey = '0x4AAAAAADluQlA5vAUrHKNJ';

    const text = {
        en: {
            modalTitle: 'Apply to RhOS',
            modalIntro: 'Submit your information and resume. HR will review your application and follow up by email.',
            position: 'Position',
            name: 'Name',
            email: 'Email',
            phone: 'Phone',
            countryCode: 'Country code',
            phoneNumber: 'Phone number',
            resume: 'Resume',
            profileUrl: 'LinkedIn / Homepage / GitHub',
            notes: 'Additional Information',
            resumeHint: 'PDF, DOC, or DOCX. Max 10MB.',
            resumeCta: 'Choose resume',
            resumeEmpty: 'No file selected',
            verification: 'Verification',
            verificationError: 'Please complete the verification.',
            submit: 'Submit application',
            submitting: 'Submitting...',
            cancel: 'Close',
            success: 'Application submitted. We will review it soon.',
            requiredError: 'Please complete all required fields.',
            fileTypeError: 'Please upload a PDF, DOC, or DOCX resume.',
            fileSizeError: 'Resume must be 10MB or smaller.',
            submitError: 'Submission failed. Please try again later.',
            optional: 'Optional'
        },
        zh: {
            modalTitle: '加入 RhOS',
            modalIntro: '请提交你的信息和简历，HR 会查看申请并通过邮件联系你。',
            position: '应聘职位',
            name: '姓名',
            email: '邮箱',
            phone: '电话',
            countryCode: '国际区号',
            phoneNumber: '电话号码',
            resume: '简历',
            profileUrl: '领英 / 个人主页 / GitHub',
            notes: '其他',
            resumeHint: '支持 PDF、DOC、DOCX，最大 10MB。',
            resumeCta: '选择简历',
            resumeEmpty: '未选择文件',
            verification: '验证',
            verificationError: '请先完成验证。',
            submit: '提交申请',
            submitting: '提交中...',
            cancel: '关闭',
            success: '申请已提交，我们会尽快查看。',
            requiredError: '请填写所有必填项。',
            fileTypeError: '请上传 PDF、DOC 或 DOCX 格式的简历。',
            fileSizeError: '简历文件不能超过 10MB。',
            submitError: '提交失败，请稍后重试。',
            optional: '选填'
        }
    };

    function getStoredLanguage() {
        try {
            return window.localStorage?.getItem('rhos-careers-language') || 'en';
        } catch {
            return 'en';
        }
    }

    function setStoredLanguage(language) {
        try {
            window.localStorage?.setItem('rhos-careers-language', language);
        } catch {
            // Language persistence is optional.
        }
    }

    let currentLanguage = getStoredLanguage();
    let modalElements = null;
    let applicationStartedAt = Date.now();
    let turnstileWidgetId = null;

    function isChinese() {
        return currentLanguage === 'zh';
    }

    function getCurrentCopy() {
        return text[isChinese() ? 'zh' : 'en'];
    }

    function getPositionLabel(position) {
        return isChinese() ? position.titleZh : position.title;
    }

    function applyLanguage(language) {
        currentLanguage = language;
        const showChinese = language === 'zh';
        document.body.classList.toggle('show-zh', showChinese);
        document.documentElement.lang = showChinese ? 'zh-CN' : 'en';
        setStoredLanguage(language);
        document.querySelectorAll('[data-language-toggle]').forEach((button) => {
            button.setAttribute('aria-pressed', String(showChinese));
            button.textContent = showChinese ? 'EN' : '中文';
        });
        updateApplicationModalText();
    }

    function createField({ id, type = 'text', required = false, textarea = false }) {
        const label = document.createElement('label');
        label.className = 'application-field';
        label.htmlFor = id;

        const labelText = document.createElement('span');
        labelText.setAttribute('data-field-label', id);
        label.append(labelText);

        const input = textarea ? document.createElement('textarea') : document.createElement('input');
        input.id = id;
        input.name = id;
        input.required = required;
        if (!textarea) input.type = type;
        if (textarea) input.rows = 4;
        label.append(input);

        return label;
    }

    function createPhoneField() {
        const field = document.createElement('div');
        field.className = 'application-field';

        const labelText = document.createElement('span');
        labelText.setAttribute('data-field-label', 'phone');

        const row = document.createElement('div');
        row.className = 'phone-input-row';

        const codeLabel = document.createElement('label');
        codeLabel.className = 'phone-code-field';
        codeLabel.htmlFor = 'phoneCountryCode';
        const codeAssist = document.createElement('small');
        codeAssist.setAttribute('data-phone-code-label', '');
        const codeSelect = document.createElement('select');
        codeSelect.id = 'phoneCountryCode';
        codeSelect.name = 'phoneCountryCode';
        codeSelect.required = true;

        [
            ['+86', 'China +86'],
            ['+1', 'United States / Canada +1'],
            ['+44', 'United Kingdom +44'],
            ['+852', 'Hong Kong +852'],
            ['+853', 'Macau +853'],
            ['+886', 'Taiwan +886'],
            ['+65', 'Singapore +65'],
            ['+81', 'Japan +81'],
            ['+82', 'South Korea +82'],
            ['+91', 'India +91'],
            ['+62', 'Indonesia +62'],
            ['+60', 'Malaysia +60'],
            ['+63', 'Philippines +63'],
            ['+66', 'Thailand +66'],
            ['+84', 'Vietnam +84'],
            ['+61', 'Australia +61'],
            ['+64', 'New Zealand +64'],
            ['+49', 'Germany +49'],
            ['+33', 'France +33'],
            ['+39', 'Italy +39'],
            ['+34', 'Spain +34'],
            ['+31', 'Netherlands +31'],
            ['+46', 'Sweden +46'],
            ['+41', 'Switzerland +41'],
            ['+43', 'Austria +43'],
            ['+32', 'Belgium +32'],
            ['+45', 'Denmark +45'],
            ['+358', 'Finland +358'],
            ['+47', 'Norway +47'],
            ['+353', 'Ireland +353'],
            ['+351', 'Portugal +351'],
            ['+48', 'Poland +48'],
            ['+420', 'Czech Republic +420'],
            ['+30', 'Greece +30'],
            ['+90', 'Turkey +90'],
            ['+971', 'United Arab Emirates +971'],
            ['+966', 'Saudi Arabia +966'],
            ['+972', 'Israel +972'],
            ['+55', 'Brazil +55'],
            ['+52', 'Mexico +52'],
            ['+54', 'Argentina +54'],
            ['+56', 'Chile +56'],
            ['+57', 'Colombia +57'],
            ['+27', 'South Africa +27']
        ].forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            codeSelect.append(option);
        });

        const numberLabel = document.createElement('label');
        numberLabel.className = 'phone-number-field';
        numberLabel.htmlFor = 'phoneNumber';
        const numberAssist = document.createElement('small');
        numberAssist.setAttribute('data-phone-number-label', '');
        const numberInput = document.createElement('input');
        numberInput.id = 'phoneNumber';
        numberInput.name = 'phoneNumber';
        numberInput.type = 'tel';
        numberInput.required = true;
        numberInput.inputMode = 'tel';

        codeLabel.append(codeAssist, codeSelect);
        numberLabel.append(numberAssist, numberInput);
        row.append(codeLabel, numberLabel);
        field.append(labelText, row);

        return field;
    }

    function createResumeField() {
        const field = document.createElement('div');
        field.className = 'application-field resume-field';

        const labelText = document.createElement('span');
        labelText.setAttribute('data-field-label', 'resume');

        const input = document.createElement('input');
        input.id = 'resume';
        input.name = 'resume';
        input.type = 'file';
        input.required = true;
        input.accept = '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

        const control = document.createElement('label');
        control.className = 'resume-upload-control';
        control.htmlFor = 'resume';

        const badge = document.createElement('b');
        badge.textContent = 'PDF';

        const textWrap = document.createElement('div');
        const cta = document.createElement('strong');
        cta.setAttribute('data-resume-upload-cta', '');
        const fileName = document.createElement('em');
        fileName.setAttribute('data-resume-file-name', '');
        textWrap.append(cta, fileName);
        control.append(badge, textWrap);

        const hint = document.createElement('small');
        hint.setAttribute('data-resume-hint', '');

        input.addEventListener('change', () => updateResumeFileName(input));

        field.append(labelText, input, control, hint);
        return field;
    }

    function createApplicationModal() {
        if (modalElements) return modalElements;

        const overlay = document.createElement('div');
        overlay.className = 'application-modal';
        overlay.setAttribute('hidden', '');

        const dialog = document.createElement('div');
        dialog.className = 'application-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'application-title');

        const close = document.createElement('button');
        close.className = 'application-close';
        close.type = 'button';
        close.setAttribute('aria-label', 'Close');
        close.textContent = '×';

        const title = document.createElement('h2');
        title.id = 'application-title';
        title.setAttribute('data-modal-title', '');

        const intro = document.createElement('p');
        intro.className = 'application-intro';
        intro.setAttribute('data-modal-intro', '');

        const form = document.createElement('form');
        form.className = 'application-form';
        form.noValidate = true;

        const honeypot = document.createElement('input');
        honeypot.type = 'text';
        honeypot.name = 'companyWebsite';
        honeypot.tabIndex = -1;
        honeypot.autocomplete = 'off';
        honeypot.setAttribute('aria-hidden', 'true');
        honeypot.className = 'application-honeypot';

        const startedAt = document.createElement('input');
        startedAt.type = 'hidden';
        startedAt.name = 'formStartedAt';

        const turnstileToken = document.createElement('input');
        turnstileToken.type = 'hidden';
        turnstileToken.name = 'cf-turnstile-response';

        const turnstileField = document.createElement('div');
        turnstileField.className = 'application-field turnstile-field';
        const turnstileLabel = document.createElement('span');
        turnstileLabel.setAttribute('data-field-label', 'verification');
        const turnstileContainer = document.createElement('div');
        turnstileContainer.className = 'turnstile-widget';
        turnstileContainer.setAttribute('data-turnstile-widget', '');
        turnstileField.append(turnstileLabel, turnstileContainer);

        const positionLabel = document.createElement('label');
        positionLabel.className = 'application-field position-field';
        positionLabel.htmlFor = 'jobSlug';
        const positionText = document.createElement('span');
        positionText.setAttribute('data-field-label', 'position');
        const positionSelect = document.createElement('select');
        positionSelect.id = 'jobSlug';
        positionSelect.name = 'jobSlug';
        positionSelect.required = true;
        positionLabel.append(positionText, positionSelect);

        const fields = [
            positionLabel,
            createField({ id: 'name', required: true }),
            createField({ id: 'email', type: 'email', required: true }),
            createPhoneField(),
            createResumeField(),
            createField({ id: 'profileUrl', type: 'url' }),
            createField({ id: 'notes', textarea: true }),
            turnstileField
        ];
        form.append(honeypot, startedAt, turnstileToken);
        fields.forEach((field) => form.append(field));

        const status = document.createElement('p');
        status.className = 'application-status';
        status.setAttribute('role', 'status');

        const actions = document.createElement('div');
        actions.className = 'application-actions';
        const cancel = document.createElement('button');
        cancel.className = 'doc-link muted';
        cancel.type = 'button';
        cancel.setAttribute('data-modal-cancel', '');
        const submit = document.createElement('button');
        submit.className = 'doc-link';
        submit.type = 'submit';
        submit.setAttribute('data-modal-submit', '');
        actions.append(cancel, submit);

        form.append(status, actions);
        dialog.append(close, title, intro, form);
        overlay.append(dialog);
        document.body.append(overlay);

        modalElements = { overlay, dialog, close, form, positionSelect, status, cancel, submit };
        close.addEventListener('click', closeApplicationModal);
        cancel.addEventListener('click', closeApplicationModal);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) closeApplicationModal();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !overlay.hasAttribute('hidden')) closeApplicationModal();
        });
        form.addEventListener('submit', submitApplication);
        updateApplicationModalText();
        loadTurnstile();
        return modalElements;
    }

    function updateApplicationModalText() {
        if (!modalElements) return;
        const copy = getCurrentCopy();
        const labels = {
            position: copy.position,
            name: copy.name,
            email: copy.email,
            phone: copy.phone,
            resume: copy.resume,
            verification: copy.verification,
            profileUrl: `${copy.profileUrl} (${copy.optional})`,
            notes: `${copy.notes} (${copy.optional})`
        };

        modalElements.dialog.querySelector('[data-modal-title]').textContent = copy.modalTitle;
        modalElements.dialog.querySelector('[data-modal-intro]').textContent = copy.modalIntro;
        Object.entries(labels).forEach(([id, value]) => {
            const label = modalElements.dialog.querySelector(`[data-field-label="${id}"]`);
            if (label) label.textContent = value;
        });
        const phoneCodeLabel = modalElements.dialog.querySelector('[data-phone-code-label]');
        if (phoneCodeLabel) phoneCodeLabel.textContent = copy.countryCode;
        const phoneNumberLabel = modalElements.dialog.querySelector('[data-phone-number-label]');
        if (phoneNumberLabel) phoneNumberLabel.textContent = copy.phoneNumber;
        const hint = modalElements.dialog.querySelector('[data-resume-hint]');
        if (hint) hint.textContent = copy.resumeHint;
        const resumeCta = modalElements.dialog.querySelector('[data-resume-upload-cta]');
        if (resumeCta) resumeCta.textContent = copy.resumeCta;
        const resumeInput = modalElements.dialog.querySelector('#resume');
        if (resumeInput) updateResumeFileName(resumeInput);
        modalElements.cancel.textContent = copy.cancel;
        modalElements.submit.textContent = copy.submit;
        renderPositionOptions(modalElements.positionSelect.value);
    }

    function updateResumeFileName(input) {
        const fileName = modalElements?.dialog.querySelector('[data-resume-file-name]');
        if (!fileName) return;
        fileName.textContent = input.files?.[0]?.name || getCurrentCopy().resumeEmpty;
    }

    function renderPositionOptions(selectedSlug) {
        if (!modalElements) return;
        const { positionSelect } = modalElements;
        positionSelect.textContent = '';
        positions.forEach((position) => {
            const option = document.createElement('option');
            option.value = position.slug;
            option.textContent = getPositionLabel(position);
            option.dataset.title = position.title;
            option.dataset.titleZh = position.titleZh;
            positionSelect.append(option);
        });
        positionSelect.value = selectedSlug || positions[0].slug;
    }

    function openApplicationModal(defaultSlug) {
        const elements = createApplicationModal();
        elements.form.reset();
        applicationStartedAt = Date.now();
        elements.form.querySelector('input[name="formStartedAt"]').value = String(applicationStartedAt);
        updateResumeFileName(elements.form.querySelector('#resume'));
        elements.status.textContent = '';
        elements.status.className = 'application-status';
        renderPositionOptions(defaultSlug);
        elements.overlay.removeAttribute('hidden');
        document.body.classList.add('modal-open');
        setTimeout(() => elements.form.querySelector('#name')?.focus(), 0);
    }

    function closeApplicationModal() {
        if (!modalElements) return;
        modalElements.overlay.setAttribute('hidden', '');
        document.body.classList.remove('modal-open');
    }

    function loadTurnstile() {
        if (window.turnstile) {
            renderTurnstile();
            return;
        }
        if (document.querySelector('script[data-turnstile-script]')) return;

        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.setAttribute('data-turnstile-script', '');
        script.addEventListener('load', renderTurnstile);
        document.head.append(script);
    }

    function renderTurnstile() {
        if (!modalElements || !window.turnstile || turnstileWidgetId !== null) return;
        const container = modalElements.form.querySelector('[data-turnstile-widget]');
        const tokenInput = modalElements.form.querySelector('[name="cf-turnstile-response"]');
        if (!container || !tokenInput) return;

        turnstileWidgetId = window.turnstile.render(container, {
            sitekey: turnstileSiteKey,
            theme: 'dark',
            callback: (token) => {
                tokenInput.value = token;
            },
            'expired-callback': () => {
                tokenInput.value = '';
            },
            'error-callback': () => {
                tokenInput.value = '';
            }
        });
    }

    function resetTurnstile() {
        if (!modalElements) return;
        const tokenInput = modalElements.form.querySelector('[name="cf-turnstile-response"]');
        if (tokenInput) tokenInput.value = '';
        if (window.turnstile && turnstileWidgetId !== null) {
            window.turnstile.reset(turnstileWidgetId);
        }
    }

    function validateApplication(formData, file) {
        const copy = getCurrentCopy();
        const requiredFields = ['jobSlug', 'name', 'email', 'phone'];
        if (requiredFields.some((field) => !String(formData.get(field) || '').trim()) || !file || !file.name) {
            return copy.requiredError;
        }
        if (!allowedResumeTypes.includes(file.type)) return copy.fileTypeError;
        if (file.size > maxResumeBytes) return copy.fileSizeError;
        if (!String(formData.get('cf-turnstile-response') || '').trim()) return copy.verificationError;
        return '';
    }

    async function submitApplication(event) {
        event.preventDefault();
        const copy = getCurrentCopy();
        const { form, positionSelect, status, submit } = modalElements;
        const formData = new FormData(form);
        const selectedPosition = positions.find((position) => position.slug === positionSelect.value);
        const phone = [formData.get('phoneCountryCode'), formData.get('phoneNumber')]
            .map((value) => String(value || '').trim())
            .filter(Boolean)
            .join(' ');
        formData.set('phone', phone);
        const file = formData.get('resume');
        const validationError = validateApplication(formData, file);

        status.textContent = validationError;
        status.className = validationError ? 'application-status error' : 'application-status';
        if (validationError || !selectedPosition) return;

        formData.set('jobTitle', selectedPosition.title);
        formData.set('jobTitleZh', selectedPosition.titleZh);
        submit.disabled = true;
        submit.textContent = copy.submitting;

        try {
            const response = await fetch('/api/applications', {
                method: 'POST',
                body: formData
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || copy.submitError);
            status.textContent = copy.success;
            status.className = 'application-status success';
            form.reset();
            updateResumeFileName(form.querySelector('#resume'));
            resetTurnstile();
            renderPositionOptions(selectedPosition.slug);
        } catch (error) {
            status.textContent = error.message || copy.submitError;
            status.className = 'application-status error';
            resetTurnstile();
        } finally {
            submit.disabled = false;
            submit.textContent = copy.submit;
        }
    }

    applyLanguage(currentLanguage);

    document.querySelectorAll('[data-language-toggle]').forEach((button) => {
        button.addEventListener('click', () => {
            applyLanguage(document.body.classList.contains('show-zh') ? 'en' : 'zh');
        });
    });

    document.querySelectorAll('[data-apply-button]').forEach((button) => {
        button.addEventListener('click', () => {
            openApplicationModal(button.dataset.jobSlug);
        });
    });
})();
