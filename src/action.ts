import * as core from '@actions/core'
import * as github from '@actions/github'
import * as util from './util'
import { getInputs } from './inputs'

export async function run() {
  try {
    const { context } = github
    const payload = context.payload.pull_request || context.payload.issue

    core.debug(`event: ${context.eventName}`)
    core.debug(`action: ${context.payload.action}`)

    const actions = ['opened', 'edited', 'labeled', 'unlabeled']
    if (
      payload &&
      (util.isValidEvent('issues', actions) ||
        util.isValidEvent('pull_request', actions) ||
        util.isValidEvent('pull_request_target', actions))
    ) {
      const inputs = getInputs()
      core.debug(`inputs: \n${JSON.stringify(inputs, null, 2)}`)

      if (context.payload.pull_request) {
        if (payload.draft && inputs.skipDraft !== false) {
          return util.skip('is draft')
        }
      }

      if (
        inputs.skipKeywords &&
        inputs.skipKeywords.length &&
        util.hasSkipKeywords(payload.title, inputs.skipKeywords)
      ) {
        return util.skip('title includes skip-keywords')
      }

      const octokit = util.getOctokit()

      const checkIncludeLabels =
        inputs.includeLabels != null && inputs.includeLabels.length > 0
      const checkExcludeLabels =
        inputs.excludeLabels != null && inputs.excludeLabels.length > 0

      if (checkIncludeLabels || checkExcludeLabels) {
        const labelsRes = await octokit.rest.issues.listLabelsOnIssue({
          ...context.repo,
          issue_number: payload.number,
          per_page: 100,
        })
        const labels = labelsRes.data.map((item) => item.name)
        const hasAnyLabel = (inputs: string[]) =>
          labels.some((label) => inputs.includes(label))

        if (checkIncludeLabels) {
          const hasLabels = hasAnyLabel(inputs.includeLabels!)
          if (!hasLabels) {
            return util.skip(`is not labeled with any of the "includeLabels"`)
          }
        }

        if (checkExcludeLabels) {
          const hasLabels = hasAnyLabel(inputs.excludeLabels!)
          if (hasLabels) {
            return util.skip(`is labeled with one of the "excludeLabels"`)
          }
        }
      }

      const owner = payload.user.login

      if (inputs.addReviewers && context.payload.pull_request) {
        const { reviewers, teamReviewers } = util.chooseReviewers(owner, inputs)

        if (reviewers.length > 0 || teamReviewers.length > 0) {
          core.info(`Reviewers: ${JSON.stringify(reviewers, null, 2)}`)
          core.info(`Team Reviewers: ${JSON.stringify(teamReviewers, null, 2)}`)

          await octokit.rest.pulls.requestReviewers({
            ...context.repo,
            reviewers,
            team_reviewers: teamReviewers,
            pull_number: payload.number,
          })
        }
      }

      if (inputs.addAssignees) {
        const assignees = util.chooseAssignees(owner, inputs)
        if (assignees.length > 0) {
          core.info(`Assignees: ${JSON.stringify(assignees, null, 2)}`)
          await octokit.rest.issues.addAssignees({
            ...context.repo,
            assignees,
            issue_number: payload.number,
          })
        }
      }
    }
  } catch (e) {
    core.error(e)
    core.setFailed(e.message)
  }
}
