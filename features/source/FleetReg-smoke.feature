Feature: Hyundai Fleet Registration - Verify status code in API Payload
as a hyundai customer
I want to verify the status of my submission

Background:
Given the user has loaded the test data from the confluence page "Automation Test Data" and find the test data "Fleet registration - Test Data"
And the user navigates to Fleet Registration
And Form has loaded successfully


#Successful submission
 # ============================================================
  # SUCCESSFUL SUBMISSION → STATUS CODE 200
  # ============================================================

  @regression @Positive @StatusCode200
  Scenario: Successful submission returns status code 200
    When the user enters a Title
    And the user enters a valid first name
    And the user enters a valid last name
    And the user enters a valid email address
    And the user enters a valid phone number
    And the user selects option on Person Submitting Form Same as Above
    And the user selects Position in the pulldown
    And the user inputs a valid ABN
    And the user enters Company Name
    And the user selects a Purchase Category
    And the user selects an Industry
    And the user enters an address
    And the user enters a suburb
    And the user enters a stage
    And the user enters a Postcode
    And the user enters Fleet Size
    And the user enters Vehicle Replacement Policy in months
    And the user enters Vehicle Replacement Policy in kms
    And the user accepts the marketing authorisation
    And the user submits the fleet registration form
    Then the form should be submitted successfully
    And it will return status code 200 in the API
    And a confirmation message should be displayed
