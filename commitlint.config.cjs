module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-min-length': [2, 'always', 16],
    'body-empty': [2, 'never'],
    'body-min-length': [2, 'always', 72],
    'body-leading-blank': [2, 'always'],
    'body-max-line-length': [2, 'always', 120],
  },
};
