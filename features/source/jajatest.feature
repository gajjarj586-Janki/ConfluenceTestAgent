Feature: user visit on hyundai CPC page

Background:
Given the user is in this link "https://dev.hyundai.com.au/au/en/shop/calculator/"
And the page is fully loaded


#Successful submission
 # ============================================================
  # SUCCESSFUL SUBMISSION → STATUS CODE 200
  # ============================================================

  @jajatest @smoke
  Scenario: user visit on the hyundai CPC page
    Given the user is in this link "https://dev.hyundai.com.au/au/en/shop/calculator/"
    And the page is fully loaded
    Then the user should see the "Configure your Hyundai." title
  