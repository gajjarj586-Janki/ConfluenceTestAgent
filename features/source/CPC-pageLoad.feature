Feature: Hyundai CPC - Ensure all models' CPC pages load
  As a QA tester
  I want to open the CPC (calculator) page for every model
  So that I can confirm each page loads, flagging any that are blank, error, or never finish loading

  Background:
    Given the user is on the Hyundai Australia homepage "https://www.hyundai.com/au/en"
    And the page is fully loaded

  @cpc @pageLoad @smoke @no-autofix
  Scenario: Every model's CPC page loads successfully
    When the user navigates to the calculator landing page
    Then the calculator landing page should list at least 1 model
    When the user opens the CPC page for every model
    Then every model's CPC page should return HTTP status 200
    And no model's CPC page should be blank
    And no model's CPC page should still be loading after 30 seconds
    And no model's CPC page should show a Coming Soon placeholder
    And a CPC page-load report should be generated
      # "Opens" = clicks each model tile on the calculator landing page to open
      # its CPC page (a real user journey, which also catches broken model links),
      # then confirms the calculator renders. This is a LOAD test — the captured
      # price is only evidence the page rendered (the price on load, often a
      # pre-selected trim), NOT the model's authoritative price. For exact
      # per-variant pricing, see the calculator_pricing feature.
      # Report contains one row per model tile with columns:
      #   Model | CPC URL | HTTP Status | Price (load evidence) | Load Time | Load Result (PASS/FAIL) | Failure Reason
      # Failure Reason examples:
      #   - "CPC page returned HTTP <status>"
      #   - "CPC page is blank (no calculator content rendered)"
      #   - "CPC page still loading after 30s (spinner / network never settled)"
      #   - "Navigation to CPC page timed out"
      # Artefacts: excel-reports/CpcPageLoad_<timestamp>.{html,json,pdf}
